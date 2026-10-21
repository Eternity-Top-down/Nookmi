import { useMemo, useState } from "react";
import { ChevronRight, Clock3, Copy, Pencil, Trash2 } from "lucide-react";
import { Modal } from "./components";
import FeedbackWordExport from "./FeedbackWordExport";
import { copyFeedbackText, formatFeedbackPeriod, getOneToOneTitle, resolveLessonNumber, withSuggestedLessonNumbers } from "./feedback";
import { historicalFeedbackCopy, sortFeedbackHistory } from "./feedbackHistoryModel";
import { normalizeOneToOneTasks } from "./feedbackModel";
import type { FeedbackSession, Student, StudentObservations } from "./types";

interface FeedbackHistoryProps {
  sessions: FeedbackSession[];
  students: Student[];
  className?: string;
  currentSessionId?: string;
  onEdit?: (session: FeedbackSession) => void;
  onDelete?: (session: FeedbackSession) => void;
}

const observationLabels: [Exclude<keyof StudentObservations, "subjects">, string][] = [
  ["performance", "本次情况"], ["strengths", "值得肯定"], ["difficulties", "需要关注"],
  ["plan", "下一步建议"], ["tasks", "课后任务"],
];

function ReadField({ label, value }: { label: string; value: string | undefined }) {
  return value?.trim() ? <div className="fb-history-field"><h4>{label}</h4><p>{value}</p></div> : null;
}

/** Read-only saved information; opening it never replaces the current working draft. */
export function FeedbackHistoryDetail({ session, students, sessions = [], onCopy, copying = false }: {
  session: FeedbackSession;
  students: Student[];
  sessions?: FeedbackSession[];
  onCopy: (studentId: string) => void;
  copying?: boolean;
}) {
  const saved = normalizeOneToOneTasks(session.module === "one-to-one"
    ? { ...session, lessonNumber: resolveLessonNumber(session, sessions) } : session);
  const brief = saved.brief;
  return <div className="fb-history-detail">
    {brief && <section className="fb-history-context">
      <h3>{saved.module === "one-to-one" ? "课程信息" : "本期教学信息"}</h3>
      <p className="fb-history-meta">{brief.subjects.join("、") || "未填写科目"} · {brief.length === "brief" ? "简短反馈" : "完整反馈"}</p>
      <ReadField label="教学 / 学习内容" value={brief.teachingContent} />
      {saved.module !== "one-to-one" && <ReadField label="全班安排 / 共性提醒" value={brief.commonTasks} />}
      <ReadField label="反馈表达重点" value={brief.focus} />
    </section>}
    {students.map((student) => {
      const entry = saved.entries.find((item) => item.studentId === student.id);
      if (!entry) return null;
      const facts = entry.observations;
      const hasFacts = facts && (observationLabels.some(([key]) => facts[key]?.trim()) || Object.values(facts.subjects).some((value) => value.trim()));
      return <section key={student.id} className="fb-history-student">
        <div className="fb-history-student-heading">
          <div><h3>{student.name}</h3><span className="fb-history-meta">{entry.content.trim() ? entry.reviewed ? "已核对" : "待核对 · 发送前请检查" : "尚未完成正文"}</span></div>
          <button type="button" className="button button-secondary button-sm" disabled={copying || !entry.content.trim()}
            aria-label={`复制${student.name}的本次反馈`} onClick={() => onCopy(student.id)}><Copy size={14} />复制反馈</button>
        </div>
        {saved.module === "one-to-one" && <div className="fb-feedback-title" aria-label="反馈标题">
          <span>反馈标题</span>
          <strong>{getOneToOneTitle(saved, student, sessions)}</strong>
        </div>}
        <div className="fb-history-body">{entry.content.trim() || "这次已保存填写记录，还没有反馈正文。"}</div>
        {hasFacts && <details className="fb-history-facts"><summary>查看填写记录<ChevronRight size={14} /></summary>
          {observationLabels.map(([key, label]) => <ReadField key={key} label={label} value={facts[key]} />)}
          {Object.entries(facts.subjects).map(([subject, value]) => <ReadField key={subject} label={`${subject}情况`} value={value} />)}
        </details>}
      </section>;
    })}
    <p className="fb-history-meta fb-history-timestamps">创建于 {new Date(saved.createdAt).toLocaleString("zh-CN", { hour12: false })} · 最近保存 {new Date(saved.updatedAt).toLocaleString("zh-CN", { hour12: false })}</p>
  </div>;
}

export default function FeedbackHistory({ sessions, students, className, currentSessionId, onEdit, onDelete }: FeedbackHistoryProps) {
  const ordered = useMemo(() => sortFeedbackHistory(withSuggestedLessonNumbers(sessions)), [sessions]);
  const [limit, setLimit] = useState(20);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = ordered.find((session) => session.id === selectedId);
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState("");
  const [fallback, setFallback] = useState<{ text: string; reason: string } | null>(null);

  async function copy(session: FeedbackSession, studentId?: string) {
    const result = historicalFeedbackCopy(session, students, className, studentId);
    if (!result.text || copying) return;
    setCopying(true);
    setNotice("");
    const warning = result.unreviewed ? "含待核对正文，请检查后再发送。" : "";
    try {
      await copyFeedbackText(result.text);
      setNotice(`已复制${result.count > 1 ? ` ${result.count} 位学生的` : ""}本次反馈。${warning}`);
    } catch (error) {
      setFallback({ text: result.text, reason: `${error instanceof Error ? error.message : "请手动复制下方反馈。"}${warning}` });
    } finally {
      setCopying(false);
    }
  }

  const copyLabel = (session: FeedbackSession) => session.module === "one-to-one" || students.length === 1 ? "快速复制" : "复制本次全班反馈";
  return <>
    <details className="fb-history" open>
      <summary><span><Clock3 size={17} />历史反馈 <strong>{ordered.length} 次 · 按课程 / 周期倒序</strong></span><ChevronRight size={16} /></summary>
      {ordered.length ? <>
        <div className="fb-history-list">
          {ordered.slice(0, limit).map((session) => {
            const available = historicalFeedbackCopy(session, students, className);
            const oneToOneStudent = session.module === "one-to-one" && students.find((student) => student.id === session.studentId);
            const oneToOneTitle = oneToOneStudent && getOneToOneTitle(session, oneToOneStudent, sessions);
            return <article key={session.id} className={`fb-history-card ${session.id === currentSessionId ? "fb-history-active" : ""}`}>
              <button type="button" className="fb-history-open" aria-label={`查看${formatFeedbackPeriod(session)}反馈详情`}
                onClick={() => { setSelectedId(session.id); setNotice(""); }}>
                <strong>{formatFeedbackPeriod(session)}</strong>
                {oneToOneTitle && <span>{oneToOneTitle}</span>}
                <span>{available.count ? `${available.count} 人有正文 · ${available.count - available.unreviewed} 人已核对${available.unreviewed ? ` · ${available.unreviewed} 人待核对` : ""}` : "已记录，待完成正文"}</span>
                <span className="fb-history-view">查看详情<ChevronRight size={14} /></span>
              </button>
              <button type="button" className="button button-secondary button-sm fb-history-copy" disabled={copying || !available.text}
                aria-label={`${formatFeedbackPeriod(session)} · ${copyLabel(session)}`} onClick={() => void copy(session)}><Copy size={14} />{copyLabel(session)}</button>
              {onDelete && <button type="button" className="button button-ghost button-sm fb-history-delete"
                aria-label={`删除${formatFeedbackPeriod(session)}反馈`} onClick={() => onDelete(session)}><Trash2 size={14} />删除这次反馈</button>}
            </article>;
          })}
        </div>
        {limit < ordered.length && <button type="button" className="button button-ghost button-sm fb-more" onClick={() => setLimit((count) => count + 20)}>查看更多历史</button>}
      </> : <p className="fb-history-empty">保存后，每次课程或周期的反馈都会显示在这里，可查看详情或快速复制。</p>}
      {notice && !selected && <p className="fb-history-notice" role="status">{notice}</p>}
    </details>
    {selected && !fallback && <Modal title="历史反馈详情" subtitle={formatFeedbackPeriod(selected)} wide onClose={() => setSelectedId(null)}>
      <div className="fb-history-detail-actions">
        <span>已保存的内容</span>
        <FeedbackWordExport session={selected} students={students} className={className} buttonClassName="button button-secondary button-sm" />
        <button type="button" className="button button-primary button-sm" disabled={copying || !historicalFeedbackCopy(selected, students, className).text}
          onClick={() => void copy(selected)}><Copy size={14} />{copyLabel(selected)}</button>
        {onEdit && <button type="button" className="button button-secondary button-sm" onClick={() => { setSelectedId(null); onEdit(selected); }}><Pencil size={14} />继续编辑</button>}
        {onDelete && <button type="button" className="button button-ghost button-sm fb-history-delete" onClick={() => { setSelectedId(null); onDelete(selected); }}><Trash2 size={14} />删除这次反馈</button>}
      </div>
      {notice && <p className="fb-history-notice" role="status">{notice}</p>}
      <FeedbackHistoryDetail session={selected} students={students} sessions={sessions} onCopy={(id) => void copy(selected, id)} copying={copying} />
    </Modal>}
    {fallback && <Modal title="手动复制历史反馈" subtitle={fallback.reason} wide onClose={() => setFallback(null)}>
      <label className="field">待复制的反馈<textarea className="fb-copy-fallback" readOnly rows={12} value={fallback.text} onFocus={(event) => event.target.select()} /></label>
      <p className="field-hint">选中文字后按 Ctrl+C（Mac 按 ⌘C），或使用设备的复制菜单。</p>
      <div className="form-actions"><button type="button" className="button button-primary" onClick={() => setFallback(null)}>完成</button></div>
    </Modal>}
  </>;
}
