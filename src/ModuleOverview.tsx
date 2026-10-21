import { useMemo, useState } from "react";
import { ArrowRight, ChevronRight, Copy, Search, Users } from "lucide-react";
import { Modal } from "./components";
import { FeedbackHistoryDetail } from "./FeedbackHistory";
import { copyFeedbackText, formatFeedbackPeriod, getOneToOneTitle, withSuggestedLessonNumbers } from "./feedback";
import { historicalFeedbackCopy, sortFeedbackHistory } from "./feedbackHistoryModel";
import type { ClassGroup, FeedbackSession, ModuleId, Student } from "./types";
import "./ModuleOverview.css";

export type OverviewMode = "students" | "grades" | "classes" | "feedback";

export interface ModuleFeedbackItem {
  session: FeedbackSession;
  students: Student[];
  className?: string;
  label: string;
  title: string;
  count: number;
  unreviewed: number;
}

/** Keep the card count and list on the same saved-body and module boundary. */
export function moduleFeedbackItems(module: ModuleId, sessions: FeedbackSession[], students: Student[], classes: ClassGroup[]): ModuleFeedbackItem[] {
  const roster = students.filter((student) => student.module === module);
  const groups = new Map(classes.filter((group) => group.module === module).map((group) => [group.id, group]));
  const records = withSuggestedLessonNumbers(sessions.filter((session) => session.module === module));
  return sortFeedbackHistory(records).flatMap((session) => {
    const group = session.classId ? groups.get(session.classId) : undefined;
    if (module !== "one-to-one" && !group) return [];
    const members = roster.filter((student) => module === "one-to-one"
      ? student.id === session.studentId && student.classId === null
      : student.classId === session.classId);
    const memberIds = new Set(members.map((student) => student.id));
    const entries = session.entries.filter((entry) => memberIds.has(entry.studentId) && entry.content.trim());
    if (!entries.length) return [];
    return [{
      session, students: members, className: group?.name,
      label: module === "one-to-one" ? members[0].name : group!.name,
      title: module === "one-to-one" ? getOneToOneTitle(session, members[0], records) : formatFeedbackPeriod(session),
      count: entries.length, unreviewed: entries.filter((entry) => !entry.reviewed).length,
    }];
  });
}

export function searchOverviewStudents(students: Student[], classes: ClassGroup[], query: string): Student[] {
  const term = query.trim().toLocaleLowerCase();
  if (!term) return students;
  const names = new Map(classes.map((group) => [group.id, group.name]));
  return students.filter((student) => [student.name, student.school, student.grade, names.get(student.classId ?? "") ?? ""]
    .some((value) => value.toLocaleLowerCase().includes(term)));
}

const gradeOrder = ["一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "初一", "初二", "初三", "高一", "高二", "高三"];
export function groupOverviewStudents(mode: "grades" | "classes", students: Student[], classes: ClassGroup[]) {
  if (mode === "classes") return classes.map((group) => ({
    key: group.id, label: group.name, subtitle: group.grade, group,
    students: students.filter((student) => student.classId === group.id),
  }));
  const grades = [...new Set(students.map((student) => student.grade.trim()))].sort((a, b) => {
    if (!a || !b) return a ? -1 : b ? 1 : 0;
    const left = gradeOrder.indexOf(a), right = gradeOrder.indexOf(b);
    return (left < 0 ? gradeOrder.length : left) - (right < 0 ? gradeOrder.length : right) || a.localeCompare(b, "zh-CN");
  });
  return grades.map((grade) => ({ key: grade, label: grade || "未填写年级", subtitle: "", group: undefined,
    students: students.filter((student) => student.grade.trim() === grade) }));
}

const modeLabels: Record<OverviewMode, string> = { students: "在册学生", grades: "覆盖年级", classes: "教学班级", feedback: "已保存课程反馈" };

export function OverviewStudentList({ students, classes, onStudent }: {
  students: Student[]; classes: ClassGroup[]; onStudent: (student: Student) => void;
}) {
  const classNames = new Map(classes.map((group) => [group.id, group.name]));
  return <div className="overview-students">
    {students.map((student) => <button type="button" className="overview-student" key={student.id}
      aria-label={`查看${student.name}的学生档案`} onClick={() => onStudent(student)}>
      <span className="overview-avatar"><Users size={17} /></span>
      <span><strong>{student.name}</strong><small>{[student.grade, student.school, classNames.get(student.classId ?? "")].filter(Boolean).join(" · ") || "未补充年级和学校"}</small></span>
      <ChevronRight size={16} />
    </button>)}
  </div>;
}

export function OverviewFeedbackList({ items, copying, onDetail, onCopy }: {
  items: ModuleFeedbackItem[]; copying: boolean; onDetail: (item: ModuleFeedbackItem) => void; onCopy: (item: ModuleFeedbackItem) => void;
}) {
  return <div className="overview-feedback-list">
    {items.map((item) => <article key={item.session.id} className="overview-feedback-card">
      <button type="button" className="overview-feedback-open" onClick={() => onDetail(item)}
        aria-label={`查看${item.label} · ${formatFeedbackPeriod(item.session)}反馈详情`}>
        <span className="overview-feedback-owner">{item.label}</span><strong>{item.title}</strong>
        {item.session.module === "one-to-one" && <span>{formatFeedbackPeriod(item.session)}</span>}
        <span>{item.count} 人有正文 · {item.unreviewed ? `${item.unreviewed} 人待核对` : "全部已核对"}</span>
        <span className="overview-open-hint">查看详情<ChevronRight size={14} /></span>
      </button>
      <button type="button" className="button button-secondary button-sm" disabled={copying || !item.count}
        aria-label={`快速复制${item.label} · ${formatFeedbackPeriod(item.session)}反馈`} onClick={() => onCopy(item)}><Copy size={14} />快速复制</button>
    </article>)}
  </div>;
}

export default function ModuleOverview({ module, moduleTitle, mode, students, classes, sessions, onClose, onStudent, onClass }: {
  module: ModuleId; moduleTitle: string; mode: OverviewMode; students: Student[]; classes: ClassGroup[]; sessions: FeedbackSession[];
  onClose: () => void; onStudent: (student: Student) => void; onClass: (group: ClassGroup) => void;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(30);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState("");
  const [fallback, setFallback] = useState<{ text: string; reason: string } | null>(null);
  const roster = students.filter((student) => student.module === module);
  const groups = classes.filter((group) => group.module === module);
  const history = useMemo(() => moduleFeedbackItems(module, sessions, students, classes), [module, sessions, students, classes]);
  const selected = history.find((item) => item.session.id === selectedId);
  const filteredStudents = searchOverviewStudents(roster, groups, query);
  const grouped = mode === "grades" || mode === "classes" ? groupOverviewStudents(mode, roster, groups).map((item) => ({ ...item,
    visible: item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) ? item.students
      : searchOverviewStudents(item.students, groups, query),
  })).filter((item) => !query.trim() || item.visible.length || item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : [];
  const matchingFeedback = history.filter((item) => [item.label, item.title, formatFeedbackPeriod(item.session), item.session.brief?.subjects.join("、") ?? "",
    ...item.students.filter((student) => item.session.entries.some((entry) => entry.studentId === student.id && entry.content.trim()))
      .flatMap((student) => [student.name, student.school])].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  async function copy(item: ModuleFeedbackItem, studentId?: string) {
    if (copying) return;
    const result = historicalFeedbackCopy(item.session, item.students, item.className, studentId);
    if (!result.text) { setNotice("这条记录没有可复制的正文。"); return; }
    const warning = result.unreviewed ? "含待核对正文，请检查后再发送。" : "";
    setCopying(true);
    setNotice("");
    try {
      await copyFeedbackText(result.text);
      setNotice(`已复制${result.count > 1 ? ` ${result.count} 位学生的` : ""}反馈。${warning}`);
    } catch (error) {
      setFallback({ text: result.text, reason: `${error instanceof Error ? error.message : "请手动复制下方正文。"}${warning}` });
    } finally { setCopying(false); }
  }

  const visibleCount = mode === "feedback" ? matchingFeedback.length : mode === "students" ? filteredStudents.length : grouped.length;
  return <>
    <Modal title={`${moduleTitle} · ${modeLabels[mode]}`} wide onClose={onClose}
      subtitle={mode === "feedback" ? `共 ${history.length} 次有正文的已保存反馈，按课程 / 周期倒序。待核对内容保留标识。` : `当前模块共 ${roster.length} 位学生，点击姓名进入学生档案。`}>
      <div className="module-overview">
        <label className="search-input overview-search"><Search size={17} />
          <input aria-label={mode === "feedback" ? "搜索已保存反馈" : "搜索模块学生"} placeholder={mode === "feedback" ? "搜索学生、班级、日期或科目…" : "搜索姓名、学校、年级或班级…"}
            value={query} onChange={(event) => { setQuery(event.target.value); setLimit(30); }} />
        </label>
        {notice && <p className="fb-history-notice" role="status">{notice}</p>}
        {!visibleCount && <p className="overview-empty">{query.trim() ? "没有找到匹配的记录。" : mode === "feedback" ? "暂时没有已保存的反馈正文。写好并保存后，会按日期显示在这里。" : "当前模块还没有相关资料。"}</p>}
        {mode === "students" && <><p className="overview-count">{filteredStudents.length} 位学生</p>
          <OverviewStudentList students={filteredStudents.slice(0, limit)} classes={groups} onStudent={onStudent} />
        </>}
        {(mode === "grades" || mode === "classes") && <div className="overview-groups">
          {grouped.map((item) => <section className="overview-group" key={item.key}>
            <div className="overview-group-heading"><div><h3>{item.label}<span>{item.students.length} 位学生</span></h3>{item.subtitle && <p>{item.subtitle}</p>}</div>
              {item.group && <button type="button" className="button button-ghost button-sm" onClick={() => onClass(item.group!)}>进入班级<ArrowRight size={14} /></button>}
            </div>
            {item.visible.length ? <OverviewStudentList students={item.visible} classes={groups} onStudent={onStudent} /> : <p className="overview-empty">该班级还没有学生。</p>}
          </section>)}
        </div>}
        {mode === "feedback" && <OverviewFeedbackList items={matchingFeedback.slice(0, limit)} copying={copying}
          onDetail={(item) => { setSelectedId(item.session.id); setNotice(""); }} onCopy={(item) => void copy(item)} />}
        {(mode === "students" || mode === "feedback") && limit < visibleCount && <button type="button" className="button button-ghost overview-more" onClick={() => setLimit((value) => value + 30)}>查看更多（还有 {visibleCount - limit} 条）</button>}
      </div>
    </Modal>
    {selected && <Modal title={`${selected.label} · 反馈详情`} subtitle={formatFeedbackPeriod(selected.session)} wide onClose={() => setSelectedId(null)}>
      <div className="fb-history-detail-actions"><span>已保存的内容 · 只读查看</span><button type="button" className="button button-primary button-sm" disabled={copying}
        onClick={() => void copy(selected)}><Copy size={14} />快速复制本次反馈</button></div>
      {notice && <p className="fb-history-notice" role="status">{notice}</p>}
      <FeedbackHistoryDetail session={selected.session} students={selected.students} sessions={sessions.filter((session) => session.module === module)}
        onCopy={(studentId) => void copy(selected, studentId)} copying={copying} />
    </Modal>}
    {fallback && <Modal title="手动复制反馈" subtitle={fallback.reason} wide onClose={() => setFallback(null)}>
      <label className="field">待复制的反馈<textarea readOnly rows={12} value={fallback.text} onFocus={(event) => event.target.select()} /></label>
      <p className="field-hint">选中文字后按 Ctrl+C，或使用设备的复制菜单。</p>
      <div className="form-actions"><button type="button" className="button button-primary" onClick={() => setFallback(null)}>完成</button></div>
    </Modal>}
  </>;
}
