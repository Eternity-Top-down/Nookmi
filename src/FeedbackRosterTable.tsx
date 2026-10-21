import { Fragment, useId, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { hasPersonalFacts, normalizeObservations } from "./feedbackModel";
import type { FeedbackEntry, Student, StudentObservations } from "./types";
import "./feedbackRosterTable.css";

interface FeedbackRosterTableProps {
  module: "evening" | "course";
  students: Student[];
  entries: FeedbackEntry[];
  subjects: string[];
  readonly: boolean;
  failures: Map<string, string>;
  staleIds: Set<string>;
  generatingStudentId?: string;
  onObservationChange: (
    id: string,
    key: Exclude<keyof StudentObservations, "subjects">,
    value: string,
  ) => void;
  onSubjectChange: (id: string, subject: string, value: string) => void;
  onViewResult: (id: string) => void;
}

const EXTRA_FIELDS = [
  { key: "strengths", label: "值得肯定", placeholder: "已有的亮点或进步", maxLength: 2000 },
  { key: "difficulties", label: "需要关注", placeholder: "遇到的困难或薄弱点", maxLength: 2000 },
  { key: "plan", label: "下一步建议", placeholder: "你已有的建议或打算，可留空", maxLength: 2000 },
  { key: "tasks", label: "个人任务", placeholder: "仅这位学生需要完成的任务，可留空", maxLength: 8000 },
] as const;

export default function FeedbackRosterTable({
  module,
  students,
  entries,
  subjects,
  readonly,
  failures,
  staleIds,
  generatingStudentId,
  onObservationChange,
  onSubjectChange,
  onViewResult,
}: FeedbackRosterTableProps) {
  const tableId = useId();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const entriesById = new Map(entries.map((entry) => [entry.studentId, entry]));
  const isEvening = module === "evening";
  // Keep older subject notes reachable when the current subject selection changes.
  const subjectColumns = isEvening
    ? [...new Set([
        ...subjects.filter((subject) => subject.trim()),
        ...students.flatMap((student) =>
          Object.entries(entriesById.get(student.id)?.observations?.subjects ?? {})
            .filter(([, value]) => value.trim())
            .map(([subject]) => subject),
        ),
      ])]
    : [];
  const columnCount = 4 + subjectColumns.length;

  function toggleExtra(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div
      className="fb-roster-scroll"
      role="region"
      aria-label={`${isEvening ? "晚辅" : "班课"}全班反馈记录表，可横向滚动`}
      tabIndex={0}
    >
      <table
        className={`fb-roster-table fb-roster-table-${module}`}
        style={{ minWidth: isEvening ? 368 + 190 * (subjectColumns.length + 1) : 740 }}
      >
        <caption className="sr-only">
          {isEvening ? "晚辅" : "班课"}学生反馈记录。所有记录均可留空，填写真实情况后可批量生成。
        </caption>
        <colgroup>
          <col className="fb-roster-student-col" />
          <col />
          {subjectColumns.map((subject) => <col key={subject} />)}
          <col className="fb-roster-extra-col" />
          <col className="fb-roster-status-col" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="fb-roster-student-cell">学生</th>
            <th scope="col">{isEvening ? "作业与表现" : "课堂表现与知识掌握"}</th>
            {subjectColumns.map((subject) => <th scope="col" key={subject}>{subject}</th>)}
            <th scope="col">补充（选填）</th>
            <th scope="col">生成状态</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => {
            const entry = entriesById.get(student.id);
            const observations = normalizeObservations(entry?.observations);
            const hasContent = Boolean(entry?.content.trim());
            const historicalSubjects = isEvening
              ? []
              : Object.entries(observations.subjects).filter(([, value]) => value.trim());
            const extraCount = EXTRA_FIELDS.filter(({ key }) => observations[key].trim()).length + historicalSubjects.length;
            const expanded = expandedIds.has(student.id);
            const extraId = `${tableId}-${student.id}-extra`;
            const failure = failures.get(student.id);
            const status = failures.has(student.id)
              ? { text: "生成待重试", kind: "error" }
              : generatingStudentId === student.id
                ? { text: "正在生成", kind: "generating" }
                : staleIds.has(student.id)
                  ? { text: "记录已更新", kind: "stale" }
                  : hasContent && entry?.reviewed
                    ? { text: "已核对", kind: "reviewed" }
                    : hasContent
                      ? { text: "待核对", kind: "ready" }
                      : hasPersonalFacts(observations)
                        ? { text: "待生成", kind: "ready" }
                        : { text: "待记录", kind: "empty" };
            return (
              <Fragment key={student.id}>
                <tr aria-label={`${student.name}的反馈记录`}>
                  <th scope="row" className="fb-roster-student-cell">
                    <span className="fb-roster-student-name">{student.name}</span>
                    {student.grade && <small>{student.grade}</small>}
                  </th>
                  <td>
                    <textarea
                      aria-label={`${student.name}的学生情况`}
                      rows={3}
                      maxLength={2000}
                      readOnly={readonly}
                      value={observations.performance}
                      placeholder={isEvening ? "作业效率、纪律、主动提问等，短句即可" : "表现、掌握得好的点、薄弱点，写关键词或短句即可"}
                      onChange={(event) => onObservationChange(student.id, "performance", event.target.value)}
                    />
                  </td>
                  {subjectColumns.map((subject) => (
                    <td key={subject}>
                      <textarea
                        aria-label={`${student.name}的${subject}记录`}
                        rows={3}
                        maxLength={2000}
                        readOnly={readonly}
                        value={observations.subjects[subject] ?? ""}
                        placeholder="掌握情况、具体困难，短句即可"
                        onChange={(event) => onSubjectChange(student.id, subject, event.target.value)}
                      />
                    </td>
                  ))}
                  <td className="fb-roster-extra-cell">
                    <button
                      type="button"
                      className={`fb-roster-extra-button${extraCount ? " has-content" : ""}`}
                      aria-label={`${student.name}的补充记录`}
                      aria-expanded={expanded}
                      aria-controls={extraId}
                      onClick={() => toggleExtra(student.id)}
                    >
                      <span>补充{extraCount > 0 ? ` (${extraCount})` : ""}</span>
                      {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                    </button>
                  </td>
                  <td className="fb-roster-status-cell">
                    <span className={`fb-roster-status is-${status.kind}`}>{status.text}</span>
                    {failure && <small className="fb-roster-error">{failure}</small>}
                    {hasContent && <button type="button" className="fb-roster-result-button" onClick={() => onViewResult(student.id)} aria-label={`查看${student.name}的反馈结果`}>查看结果</button>}
                  </td>
                </tr>
                {expanded && (
                  <tr className="fb-roster-extra-row" id={extraId} aria-label={`${student.name}的补充内容`}>
                    <td colSpan={columnCount}>
                      <div className="fb-roster-extra-heading">
                        <strong>{student.name} · 补充记录</strong>
                        <span>已有记录会保留，不需要重复填写；建议和任务可留空。</span>
                      </div>
                      <div className="fb-roster-extra-fields">
                        {EXTRA_FIELDS.map(({ key, label, placeholder, maxLength }) => (
                          <label key={key}>
                            <span>{label}</span>
                            <textarea
                              aria-label={`${student.name}的${label}`}
                              rows={3}
                              maxLength={maxLength}
                              readOnly={readonly}
                              value={observations[key]}
                              placeholder={placeholder}
                              onChange={(event) => onObservationChange(student.id, key, event.target.value)}
                            />
                          </label>
                        ))}
                        {historicalSubjects.map(([subject, value]) => (
                          <label key={subject}>
                            <span>{subject}记录</span>
                            <textarea
                              aria-label={`${student.name}的${subject}记录`}
                              rows={3}
                              maxLength={2000}
                              readOnly={readonly}
                              value={value}
                              onChange={(event) => onSubjectChange(student.id, subject, event.target.value)}
                            />
                          </label>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
