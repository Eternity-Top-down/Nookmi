import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpFromLine,
  BookOpen,
  Check,
  ChevronRight,
  ClipboardList,
  Copy,
  Clock3,
  Database,
  FileText,
  GraduationCap,
  LayoutGrid,
  Leaf,
  Menu,
  Moon,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { ClassForm, ImportStudents, Modal, StudentForm } from "./components";
import FeedbackWorkspace from "./FeedbackWorkspace";
import AISettings from "./AISettings";
import { hasObservations } from "./feedbackModel";
import { ApiError, getWorkspace, putWorkspace } from "./api";
import {
  copyFeedbackText,
  formatFeedbackPeriod,
  formatStudentFeedback,
} from "./feedback";
import { version } from "../package.json";
import {
  createDemoData,
  EMPTY_DATA,
  loadData,
  newId,
  parseBackup,
  pruneFeedbackForStudent,
} from "./data";
import { parseRoute, routeUrl, type Route } from "./routes";
import {
  type AppData,
  type ClassGroup,
  type FeedbackSession,
  type ModuleId,
  type Student,
  type StudentFields,
} from "./types";

const MODULES = {
  "one-to-one": {
    title: "一对一",
    english: "ONE-ON-ONE",
    description: "记下本次课的真实情况，生成有针对性的家长反馈。",
    icon: UserRound,
    color: "green",
  },
  evening: {
    title: "晚辅",
    english: "EVENING STUDY",
    description: "按周整理作业、习惯与各科学习情况，完成每位学生的晚辅反馈。",
    icon: Moon,
    color: "purple",
  },
  course: {
    title: "班课",
    english: "GROUP CLASSES",
    description: "教学内容全班共用，结合每位学生的表现完成月度反馈。",
    icon: BookOpen,
    color: "orange",
  },
} as const;
type ModalState =
  | { kind: "student"; student?: Student }
  | { kind: "class"; group?: ClassGroup }
  | { kind: "import" }
  | { kind: "backup" }
  | { kind: "note" }
  | { kind: "ai" }
  | null;
type Confirmation = {
  title: string;
  message: string;
  action: () => void;
  label?: string;
  danger?: boolean;
} | null;

function getRoute(): Route {
  return parseRoute(window.location.hash);
}
function navigate(route: Route) {
  window.location.hash = routeUrl(route);
}
function download(text: string, filename: string, type = "application/json") {
  const url = URL.createObjectURL(
    new Blob([text], { type: `${type};charset=utf-8` }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}
function Avatar({ name, large = false }: { name: string; large?: boolean }) {
  const tone = ["sage", "sand", "lavender", "rose"][
    Array.from(name).reduce((sum, c) => sum + c.codePointAt(0)!, 0) % 4
  ];
  return (
    <span className={`avatar avatar-${tone} ${large ? "avatar-large" : ""}`}>
      {Array.from(name).slice(-2).join("")}
    </span>
  );
}
function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-illustration">
        {icon}
        <span className="empty-dot" />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function StatCard({
  label,
  value,
  suffix,
  icon,
  tone,
}: {
  label: string;
  value: number;
  suffix: string;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <div className="stat-card">
      <div>
        <span className="stat-label">{label}</span>
        <div className="stat-number">
          {value}
          <span>{suffix}</span>
        </div>
      </div>
      <span className={`stat-icon tone-${tone}`}>{icon}</span>
    </div>
  );
}

export default function App() {
  const [legacy] = useState(loadData);
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [reloadAttempt, setReloadAttempt] = useState(0);
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [showMigration, setShowMigration] = useState(true);
  const revision = useRef(0);
  const savingLock = useRef(false);
  const [route, setRoute] = useState<Route>(getRoute);
  const [modal, setModal] = useState<ModalState>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [query, setQuery] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [toast, setToast] = useState<{
    message: string;
    error?: boolean;
  } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [noteDate, setNoteDate] = useState(localDate);
  const [noteContent, setNoteContent] = useState("");
  const [activePanel, setActivePanel] = useState<"feedback" | "details">(
    "feedback",
  );
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const feedbackDirty = useRef(false);
  const routeRef = useRef(route);
  routeRef.current = route;
  const markFeedbackDirty = useCallback((dirty: boolean) => {
    feedbackDirty.current = dirty;
  }, []);
  const backupInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    setReady(false);
    setStorageError(null);
    getWorkspace()
      .then((result) => {
        if (!active) return;
        revision.current = result.revision;
        setData(result.data);
        setReady(true);
        setConflict(false);
      })
      .catch((error: Error) => {
        if (active) setStorageError(error.message);
      });
    return () => {
      active = false;
    };
  }, [reloadAttempt]);

  useEffect(() => {
    const onHash = () => {
      const nextRoute = getRoute();
      setSidebarOpen(false);
      if (routeUrl(nextRoute) === routeUrl(routeRef.current)) return;
      if (feedbackDirty.current) {
        window.history.replaceState(null, "", routeUrl(routeRef.current));
        setConfirmation({
          title: "当前反馈尚未完成",
          message:
            "当前有未保存的修改或正在进行的生成。离开会放弃未保存内容并停止生成，可以取消后继续处理。",
          label: "放弃修改并离开",
          action: () => {
            feedbackDirty.current = false;
            setConfirmation(null);
            navigate(nextRoute);
          },
        });
        return;
      }
      setRoute(nextRoute);
      setActivePanel("feedback");
      setQuery("");
      setGradeFilter("");
      setSidebarOpen(false);
      setModal(null);
      setConfirmation(null);
    };
    window.addEventListener("hashchange", onHash);
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (feedbackDirty.current || savingLock.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 9000 : 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    document.title = `${MODULES[route.module].title} · Nookmi 数学教学工作台`;
  }, [route.module]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  const config = MODULES[route.module];
  const group = data.classes.find(
    (c) => c.id === route.classId && c.module === route.module,
  );
  const student = data.students.find(
    (s) =>
      s.id === route.studentId &&
      s.module === route.module &&
      s.classId === (route.classId || null),
  );
  const missingRoute =
    (route.classId && !group) || (route.studentId && !student);
  const moduleStudents = data.students.filter((s) => s.module === route.module);
  const classes = data.classes.filter((c) => c.module === route.module);
  const listedStudents = group
    ? moduleStudents.filter((s) => s.classId === group.id)
    : moduleStudents;
  const feedbackSessions = data.feedbackSessions ?? [];
  const moduleFeedback = feedbackSessions.filter(
    (s) => s.module === route.module,
  );
  const scopedFeedback = moduleFeedback.filter((s) =>
    student?.module === "one-to-one"
      ? s.studentId === student.id
      : s.classId === group?.id,
  );
  const personalFeedback = scopedFeedback
    .filter((s) =>
      s.entries.some(
        (entry) =>
          entry.studentId === student?.id &&
          (entry.content.trim() || hasObservations(entry.observations)),
      ),
    )
    .sort((a, b) => b.lessonAt.localeCompare(a.lessonAt));
  const studentRecords = data.records
    .filter((r) => r.studentId === student?.id)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
    );
  const grades = [
    ...new Set(listedStudents.map((s) => s.grade).filter(Boolean)),
  ].sort();
  const filteredStudents = listedStudents.filter(
    (s) =>
      (!gradeFilter || s.grade === gradeFilter) &&
      [s.name, s.school, s.guardian, s.phone, s.grade].some((value) =>
        value.toLowerCase().includes(query.trim().toLowerCase()),
      ),
  );
  const filteredClasses = classes.filter((c) =>
    [c.name, c.grade, c.schedule].some((value) =>
      value.toLowerCase().includes(query.trim().toLowerCase()),
    ),
  );
  const isEmpty = !data.students.length && !data.classes.length;
  const showStudentList = route.module === "one-to-one" || !!group;

  function changePanel(next: "feedback" | "details") {
    if (next === activePanel) return;
    if (feedbackDirty.current) {
      setConfirmation({
        title: "当前反馈尚未完成",
        message:
          "当前有未保存的修改或正在进行的生成。切换页面会放弃未保存内容并停止生成，可以取消后继续处理。",
        label: "放弃修改并切换",
        action: () => {
          feedbackDirty.current = false;
          setConfirmation(null);
          setActivePanel(next);
        },
      });
    } else setActivePanel(next);
  }
  async function saveFeedback(session: FeedbackSession) {
    return persist(
      {
        ...data,
        feedbackSessions: feedbackSessions.some((s) => s.id === session.id)
          ? feedbackSessions.map((s) => (s.id === session.id ? session : s))
          : [...feedbackSessions, session],
      },
      "本次课程反馈已保存",
    );
  }
  async function copyPersonalFeedback(
    session: FeedbackSession,
    target: Student,
  ) {
    const entry = session.entries.find(
      (value) => value.studentId === target.id,
    );
    if (session.brief && !entry?.reviewed) {
      setToast({
        message: "请先到班级反馈页核对这位学生的正文，再复制。",
        error: true,
      });
      return;
    }
    const text = formatStudentFeedback(session, target, group?.name);
    try {
      await copyFeedbackText(text);
      setToast({ message: "反馈已复制，可以直接粘贴发送。" });
    } catch {
      setManualCopy(text);
    }
  }
  function workspaceTabs(personal = false) {
    return (
      <div
        className="work-tabs"
        role="group"
        aria-label={personal ? "学生工作页面" : "班级工作页面"}
      >
        <button
          className={activePanel === "feedback" ? "active" : ""}
          aria-pressed={activePanel === "feedback"}
          onClick={() => changePanel("feedback")}
        >
          <MessageSquareText size={17} />
          {personal ? "课程反馈" : "班级反馈"}
        </button>
        <button
          className={activePanel === "details" ? "active" : ""}
          aria-pressed={activePanel === "details"}
          onClick={() => changePanel("details")}
        >
          {personal ? <UserRound size={17} /> : <Users size={17} />}
          {personal ? "学生档案与笔记" : "学生管理"}
        </button>
      </div>
    );
  }
  async function persist(next: AppData, message: string) {
    if (!ready || storageError) {
      setToast({
        message: "请先连接本地数据库，再保存数据。",
        error: true,
      });
      return false;
    }
    if (savingLock.current) return false;
    savingLock.current = true;
    setSaving(true);
    try {
      const saved = await putWorkspace(next, revision.current);
      revision.current = saved.revision;
      setData(saved.data);
      setConflict(false);
      setSavedAt(
        new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      setToast({ message });
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      setToast({
        message:
          error instanceof Error
            ? error.message
            : "保存失败，请导出备份后重试。",
        error: true,
      });
      return false;
    } finally {
      savingLock.current = false;
      setSaving(false);
    }
  }
  async function saveStudent(fields: StudentFields, editing?: Student) {
    const now = new Date().toISOString();
    const updated: Student = editing
      ? { ...editing, ...fields, updatedAt: now }
      : {
          ...fields,
          id: newId(),
          module: route.module,
          classId: group?.id || null,
          createdAt: now,
          updatedAt: now,
        };
    if (
      await persist(
        {
          ...data,
          students: editing
            ? data.students.map((s) => (s.id === editing.id ? updated : s))
            : [...data.students, updated],
        },
        editing ? "学生信息已更新" : `已添加 ${fields.name}`,
      )
    )
      setModal(null);
  }
  async function saveClass(
    fields: Pick<ClassGroup, "name" | "grade" | "schedule" | "notes">,
    editing?: ClassGroup,
  ) {
    if (route.module === "one-to-one") return;
    if (
      classes.some(
        (c) => c.name.trim() === fields.name.trim() && c.id !== editing?.id,
      )
    ) {
      setToast({
        message: "当前模块已有同名班级，请使用不同名称。",
        error: true,
      });
      return;
    }
    const updated: ClassGroup = editing
      ? { ...editing, ...fields }
      : {
          ...fields,
          id: newId(),
          module: route.module,
          createdAt: new Date().toISOString(),
        };
    if (
      await persist(
        {
          ...data,
          classes: editing
            ? data.classes.map((c) => (c.id === editing.id ? updated : c))
            : [...data.classes, updated],
        },
        editing ? "班级信息已更新" : "班级已创建，现在可以录入学生了",
      )
    ) {
      setModal(null);
      if (!editing) navigate({ module: route.module, classId: updated.id });
    }
  }
  async function importStudents(fields: StudentFields[]) {
    const now = new Date().toISOString();
    const additions = fields.map((values) => ({
      ...values,
      id: newId(),
      module: route.module,
      classId: group?.id || null,
      createdAt: now,
      updatedAt: now,
    }));
    if (
      await persist(
        { ...data, students: [...data.students, ...additions] },
        `成功录入 ${additions.length} 位学生`,
      )
    )
      setModal(null);
  }
  function deleteStudent(target: Student) {
    setConfirmation({
      title: `删除学生「${target.name}」？`,
      message:
        "该学生的个人信息、课程反馈和教学记录会一并删除。此操作无法撤销，建议先导出数据备份。",
      label: "确认删除",
      danger: true,
      action: async () => {
        if (
          await persist(
            {
              ...data,
              students: data.students.filter((s) => s.id !== target.id),
              records: data.records.filter((r) => r.studentId !== target.id),
              feedbackSessions: pruneFeedbackForStudent(
                feedbackSessions,
                target.id,
              ),
            },
            "学生已删除",
          )
        ) {
          setConfirmation(null);
          feedbackDirty.current = false;
          navigate({ module: route.module, classId: group?.id });
        }
      },
    });
  }
  function deleteClass(target: ClassGroup) {
    const ids = new Set(
      data.students.filter((s) => s.classId === target.id).map((s) => s.id),
    );
    setConfirmation({
      title: `删除班级「${target.name}」？`,
      message: `班级内 ${ids.size} 位学生、课程反馈及教学记录会一并删除。此操作无法撤销，建议先导出数据备份。`,
      label: "删除班级及学生",
      danger: true,
      action: async () => {
        if (
          await persist(
            {
              ...data,
              classes: data.classes.filter((c) => c.id !== target.id),
              students: data.students.filter((s) => !ids.has(s.id)),
              records: data.records.filter((r) => !ids.has(r.studentId)),
              feedbackSessions: feedbackSessions.filter(
                (s) => s.classId !== target.id,
              ),
            },
            "班级已删除",
          )
        ) {
          setConfirmation(null);
          feedbackDirty.current = false;
          navigate({ module: route.module });
        }
      },
    });
  }
  function exportBackup() {
    if (!ready) {
      setToast({
        message: "数据库尚未连接，暂时无法导出当前资料。",
        error: true,
      });
      return;
    }
    download(
      JSON.stringify(data, null, 2),
      `nookmi-backup-${localDate()}.json`,
    );
    setToast({ message: "备份文件已生成，请妥善保存。" });
  }
  async function readBackup(file?: File) {
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("备份文件不能超过 10 MB。");
      const restored = parseBackup(await file.text());
      setModal(null);
      setConfirmation({
        title: "恢复这份数据备份？",
        message: `备份包含 ${restored.classes.length} 个班级、${restored.students.length} 位学生、${restored.feedbackSessions?.length ?? 0} 次课程反馈、${restored.records.length} 条教学记录。恢复将替换当前所有模块的数据；建议先导出现有备份。`,
        label: "确认替换并恢复",
        action: async () => {
          if (await persist(restored, "数据备份已恢复")) {
            setConfirmation(null);
            feedbackDirty.current = false;
            setWorkspaceEpoch((value) => value + 1);
            navigate({ module: "one-to-one" });
          }
        },
      });
    } catch (error) {
      setToast({
        message: error instanceof Error ? error.message : "无法读取备份文件。",
        error: true,
      });
    } finally {
      if (backupInput.current) backupInput.current.value = "";
    }
  }
  function openNote() {
    setNoteDate(localDate());
    setNoteContent("");
    setModal({ kind: "note" });
  }
  function reloadDatabase() {
    const reload = () => {
      feedbackDirty.current = false;
      setConfirmation(null);
      setModal(null);
      setReloadAttempt((value) => value + 1);
    };
    if (feedbackDirty.current) {
      setConfirmation({
        title: "重新读取数据库？",
        message:
          "当前编辑区还有未保存的内容，请先复制留存。继续会放弃这些修改，读取数据库中的最新记录。",
        label: "放弃修改并重新读取",
        action: reload,
      });
    } else reload();
  }
  async function migrateLegacy() {
    if (legacy.error || !isEmpty) return;
    if (
      await persist(
        legacy.data,
        "旧版学生资料和反馈已迁移到 SQLite，浏览器原始副本仍然保留。",
      )
    ) {
      setShowMigration(false);
    }
  }
  function studentTable() {
    return (
      <section className="content-card">
        <div className="section-heading">
          <div>
            <h2>
              学生名单{" "}
              <span className="count-pill">{listedStudents.length}</span>
            </h2>
            <p>
              {group
                ? "管理班级名单，点击学生可查看个人反馈。"
                : "点击学生，开始填写本次一对一课程反馈。"}
            </p>
          </div>
          <div className="section-actions">
            <button
              className="button button-secondary button-sm"
              onClick={() => setModal({ kind: "import" })}
            >
              <ArrowUpFromLine size={15} />
              批量录入
            </button>
            <button
              className="button button-primary button-sm"
              onClick={() => setModal({ kind: "student" })}
            >
              <Plus size={16} />
              添加学生
            </button>
          </div>
        </div>
        <div className="list-toolbar">
          <label className="search-input">
            <Search size={17} />
            <input
              aria-label="搜索学生"
              placeholder="搜索姓名、学校、家长或电话…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button aria-label="清空搜索" onClick={() => setQuery("")}>
                <X size={14} />
              </button>
            )}
          </label>
          <label className="filter-select">
            <Settings2 size={15} />
            <select
              aria-label="按年级筛选"
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
            >
              <option value="">全部年级</option>
              {grades.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
        </div>
        {filteredStudents.length ? (
          <>
            <div className="table-scroll">
              <table className="data-table student-table">
                <thead>
                  <tr>
                    <th>学生姓名</th>
                    <th>年级 / 学校</th>
                    <th>家长 / 联系电话</th>
                    <th>已存反馈</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() =>
                        navigate({
                          module: route.module,
                          classId: group?.id,
                          studentId: s.id,
                        })
                      }
                    >
                      <td>
                        <button
                          className="student-link"
                          onClick={() =>
                            navigate({
                              module: route.module,
                              classId: group?.id,
                              studentId: s.id,
                            })
                          }
                        >
                          <Avatar name={s.name} />
                          <span>
                            <strong>{s.name}</strong>
                            <small>加入于 {dateLabel(s.createdAt)}</small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <span className="cell-main">
                          {s.grade || "未设置年级"}
                        </span>
                        <small>{s.school || "暂未填写学校"}</small>
                      </td>
                      <td>
                        <span className="cell-main">
                          {s.guardian || "暂未填写"}
                        </span>
                        <small>{s.phone || "—"}</small>
                      </td>
                      <td>
                        <span className="record-count">
                          <FileText size={14} />
                          {
                            feedbackSessions.filter((session) =>
                              session.entries.some(
                                (entry) =>
                                  entry.studentId === s.id &&
                                  (entry.content.trim() ||
                                    hasObservations(entry.observations)),
                              ),
                            ).length
                          }{" "}
                          条
                        </span>
                      </td>
                      <td>
                        <span className="row-feedback-link">
                          {group ? "查看反馈" : "填写反馈"}
                          <ArrowRight size={15} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              共 {listedStudents.length} 位学生
              {filteredStudents.length !== listedStudents.length
                ? `，筛选显示 ${filteredStudents.length} 位`
                : ""}
              <span>
                <ShieldCheck size={13} />
                数据保存在本机 SQLite 数据库
              </span>
            </div>
          </>
        ) : (
          <EmptyState
            icon={<UserRound size={34} strokeWidth={1.3} />}
            title={
              listedStudents.length ? "没有找到匹配的学生" : "从第一位学生开始"
            }
            text={
              listedStudents.length
                ? "试试其他关键词，或清除年级筛选。"
                : "添加学生信息，或从 Excel 复制整班名单批量录入。"
            }
            action={
              listedStudents.length ? (
                <button
                  className="button button-secondary"
                  onClick={() => {
                    setQuery("");
                    setGradeFilter("");
                  }}
                >
                  清除筛选
                </button>
              ) : (
                <button
                  className="button button-primary"
                  onClick={() => setModal({ kind: "student" })}
                >
                  <Plus size={17} />
                  添加第一位学生
                </button>
              )
            }
          />
        )}
      </section>
    );
  }

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          className="sidebar-shade"
          aria-label="关闭导航"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <a className="brand" href="#/one-to-one">
          <span className="brand-symbol">
            <span />n
          </span>
          <span>
            Nookmi<small>数学教学工作台</small>
          </span>
        </a>
        <div className="workspace-switch">
          <span className="workspace-avatar">
            <GraduationCap size={19} />
          </span>
          <span>
            <strong>我的教学空间</strong>
            <small>专注教学，有序成长</small>
          </span>
          <ChevronRight size={14} />
        </div>
        <div className="nav-label">教学管理</div>
        <nav aria-label="教学模块">
          {(Object.keys(MODULES) as ModuleId[]).map((id) => {
            const item = MODULES[id];
            const Icon = item.icon;
            return (
              <a
                key={id}
                href={`#/${id}`}
                className={`nav-item ${route.module === id ? "active" : ""}`}
                aria-current={route.module === id ? "page" : undefined}
              >
                <Icon size={19} />
                <span>{item.title}</span>
                <span className="nav-count">
                  {data.students.filter((s) => s.module === id).length}
                </span>
              </a>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Leaf size={20} />
            <p>
              把琐事整理好，
              <br />
              把时间留给教学。
            </p>
            <span>ONE STUDENT AT A TIME</span>
          </div>
          <button
            className="backup-nav"
            onClick={() => {
              setModal({ kind: "ai" });
              setSidebarOpen(false);
            }}
            disabled={!ready}
          >
            <Sparkles size={18} />
            <span>AI 服务设置</span>
            <Settings2 size={16} />
          </button>
          <button
            className="nav-item backup-nav"
            onClick={() => {
              setModal({ kind: "backup" });
              setSidebarOpen(false);
            }}
          >
            <Database size={18} />
            <span>数据与备份</span>
            <MoreHorizontal size={17} />
          </button>
          <div className="sidebar-profile">
            <span className="profile-icon">教</span>
            <span>
              <strong>数学老师</strong>
              <small>个人工作台 · v{version}</small>
            </span>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="mobile-menu"
              aria-label="打开导航"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb-home">教学工作台</span>
            <ChevronRight size={14} />
            <a href={`#/${route.module}`}>{config.title}</a>
            {group && (
              <>
                <ChevronRight size={14} />
                <a href={routeUrl({ module: route.module, classId: group.id })}>
                  {group.name}
                </a>
              </>
            )}
            {student && (
              <>
                <ChevronRight size={14} />
                <span>{student.name}</span>
              </>
            )}
          </div>
          <div className="topbar-right">
            <span className="top-date">
              {new Intl.DateTimeFormat("zh-CN", {
                month: "long",
                day: "numeric",
                weekday: "long",
              }).format(new Date())}
            </span>
            <span className="subject-pill">
              <span />
              教学反馈
            </span>
          </div>
        </header>
        <main>
          {ready && conflict && (
            <div className="workspace-notice" role="alert">
              <div>
                <strong>数据库中有更新的资料</strong>
                <p>
                  为避免覆盖其他页面的修改，本次尚未保存。请先复制留存当前未保存内容，再读取最新资料。
                </p>
              </div>
              <button
                className="button button-secondary"
                onClick={reloadDatabase}
              >
                重新读取数据库
              </button>
            </div>
          )}
          {ready &&
            showMigration &&
            isEmpty &&
            (legacy.data.students.length > 0 ||
              legacy.data.classes.length > 0 ||
              legacy.error) && (
              <div className="workspace-notice">
                <div>
                  <strong>发现旧版浏览器资料</strong>
                  <p>
                    {legacy.error ||
                      `旧版有 ${legacy.data.students.length} 位学生、${legacy.data.classes.length} 个班级，可迁移到本机数据库。原始浏览器副本会保留。`}
                  </p>
                </div>
                <div className="button-row">
                  {!legacy.error && (
                    <button
                      className="button button-primary"
                      onClick={() => void migrateLegacy()}
                    >
                      迁移旧版资料
                    </button>
                  )}
                  <button
                    className="button button-secondary"
                    onClick={() => {
                      try {
                        download(
                          localStorage.getItem("nookmi:data:v1") || "",
                          `nookmi-legacy-${localDate()}.json`,
                        );
                      } catch {
                        setToast({
                          message: "浏览器不允许读取旧资料。",
                          error: true,
                        });
                      }
                    }}
                  >
                    下载旧版副本
                  </button>
                  <button
                    className="button button-ghost"
                    onClick={() => setShowMigration(false)}
                  >
                    暂不迁移
                  </button>
                </div>
              </div>
            )}
          {!ready ? (
            <section className="content-card recovery-card">
              <Database size={36} />
              <h1>{storageError ? "请连接本地后端" : "正在打开教学工作台…"}</h1>
              <p>{storageError || "正在读取 SQLite 中的学生资料与反馈。"}</p>
              <p>
                在项目目录运行 <code>npm run start</code>，会同时启动前端与
                Python 后端。
              </p>
              <div className="button-row">
                <button
                  className="button button-primary"
                  onClick={() => setReloadAttempt((value) => value + 1)}
                >
                  重新连接
                </button>
              </div>
            </section>
          ) : missingRoute ? (
            <section className="content-card">
              <EmptyState
                icon={<Search size={32} />}
                title="没有找到这个页面"
                text="这位学生或班级可能已被删除。"
                action={
                  <button
                    className="button button-primary"
                    onClick={() => navigate({ module: route.module })}
                  >
                    返回{config.title}
                  </button>
                }
              />
            </section>
          ) : student ? (
            <>
              <button
                className="back-link"
                onClick={() =>
                  navigate({ module: route.module, classId: group?.id })
                }
              >
                <ArrowLeft size={16} />
                返回{group?.name || "学生名单"}
              </button>
              <div className="student-hero">
                <Avatar name={student.name} large />
                <div className="student-heading">
                  <div className="eyebrow">
                    {config.english} · STUDENT SPACE
                  </div>
                  <h1>
                    {student.name}
                    <span className={`badge badge-${config.color}`}>
                      {config.title}
                    </span>
                  </h1>
                  <p>
                    {[student.grade, student.school, group?.name]
                      .filter(Boolean)
                      .join(" · ") || "专属教学空间，记录每一点进步。"}
                  </p>
                </div>
                <button
                  className="button button-secondary"
                  onClick={() => setModal({ kind: "student", student })}
                >
                  <Pencil size={16} />
                  编辑资料
                </button>
              </div>
              {workspaceTabs(true)}
              {activePanel === "feedback" ? (
                student.module === "one-to-one" ? (
                  <FeedbackWorkspace
                    key={`student-${student.id}-${reloadAttempt}-${workspaceEpoch}`}
                    module={student.module}
                    students={[student]}
                    studentId={student.id}
                    classId={null}
                    sessions={scopedFeedback}
                    onSave={saveFeedback}
                    onConfigureAI={() => setModal({ kind: "ai" })}
                    onDirtyChange={markFeedbackDirty}
                  />
                ) : (
                  <section className="content-card personal-feedback">
                    <div className="section-heading">
                      <div>
                        <h2>
                          个人反馈记录{" "}
                          <span className="count-pill">
                            {personalFeedback.length}
                          </span>
                        </h2>
                        <p>本班反馈集中填写，这里查看和复制该学生的反馈。</p>
                      </div>
                      <button
                        className="button button-primary"
                        onClick={() =>
                          navigate({ module: route.module, classId: group?.id })
                        }
                      >
                        <MessageSquareText size={16} />
                        去班级填写反馈
                      </button>
                    </div>
                    {personalFeedback.length ? (
                      <div className="note-list">
                        {personalFeedback.map((session) => (
                          <article className="teaching-note" key={session.id}>
                            <div className="note-top">
                              <span>
                                <Clock3 size={15} />
                                {formatFeedbackPeriod(session)}
                              </span>
                              <button
                                className="button button-secondary button-sm"
                                disabled={Boolean(
                                  session.brief &&
                                    !session.entries.find(
                                      (entry) => entry.studentId === student.id,
                                    )?.reviewed,
                                )}
                                onClick={() =>
                                  void copyPersonalFeedback(session, student)
                                }
                              >
                                <Copy size={14} />
                                {session.brief &&
                                !session.entries.find(
                                  (entry) => entry.studentId === student.id,
                                )?.reviewed
                                  ? "待核对"
                                  : "复制反馈"}
                              </button>
                            </div>
                            <p>
                              {session.entries.find(
                                (entry) => entry.studentId === student.id,
                              )?.content ||
                                "已记录个人情况，反馈正文待生成。可在班级反馈工作台继续补充。"}
                            </p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        icon={<MessageSquareText size={32} />}
                        title="还没有已保存的反馈"
                        text="在班级反馈页为这位学生填写内容并保存后，会显示在这里。"
                      />
                    )}
                  </section>
                )
              ) : (
                <div className="student-detail-grid">
                  <section className="content-card profile-card">
                    <div className="section-heading">
                      <h2>
                        <UserRound size={18} />
                        学生档案
                      </h2>
                    </div>
                    <dl className="profile-list">
                      {[
                        ["学生姓名", student.name],
                        ["所在年级", student.grade],
                        ["就读学校", student.school],
                        ["家长姓名", student.guardian],
                        ["联系电话", student.phone],
                      ].map(([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{value || "暂未填写"}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="profile-note">
                      <span>学情与备注</span>
                      <p>
                        {student.notes ||
                          "还没有备注。可以记录学生的学习特点、关注事项和教学目标。"}
                      </p>
                    </div>
                    <div className="profile-meta">
                      建档于 {dateLabel(student.createdAt)}
                      <button
                        className="icon-button danger-text"
                        aria-label={`删除学生${student.name}`}
                        onClick={() => deleteStudent(student)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </section>
                  <section className="content-card notes-card">
                    <div className="section-heading">
                      <div>
                        <h2>
                          教学记录{" "}
                          <span className="count-pill">
                            {studentRecords.length}
                          </span>
                        </h2>
                        <p>随手记下课堂表现、学习进展与下次安排。</p>
                      </div>
                      <button
                        className="button button-primary button-sm"
                        onClick={openNote}
                      >
                        <Plus size={16} />
                        添加记录
                      </button>
                    </div>
                    {studentRecords.length ? (
                      <div className="note-list">
                        {studentRecords.map((record) => (
                          <article className="teaching-note" key={record.id}>
                            <div className="note-top">
                              <span>
                                <span className="timeline-dot" />
                                {record.date.replace(/-/g, ".")}
                              </span>
                              <button
                                className="icon-button"
                                aria-label={`删除${record.date}教学记录`}
                                onClick={() =>
                                  setConfirmation({
                                    title: "删除这条教学记录？",
                                    message: "删除后无法撤销。",
                                    danger: true,
                                    label: "删除记录",
                                    action: async () => {
                                      if (
                                        await persist(
                                          {
                                            ...data,
                                            records: data.records.filter(
                                              (r) => r.id !== record.id,
                                            ),
                                          },
                                          "教学记录已删除",
                                        )
                                      )
                                        setConfirmation(null);
                                    },
                                  })
                                }
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                            <p>{record.content}</p>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        icon={<ClipboardList size={34} strokeWidth={1.3} />}
                        title="写下第一条教学记录"
                        text="今天的知识点、一个小小的进步，或下一次课的计划。"
                        action={
                          <button
                            className="button button-secondary"
                            onClick={openNote}
                          >
                            <Plus size={16} />
                            开始记录
                          </button>
                        }
                      />
                    )}
                  </section>
                </div>
              )}
            </>
          ) : (
            <>
              {group && (
                <button
                  className="back-link"
                  onClick={() => navigate({ module: route.module })}
                >
                  <ArrowLeft size={16} />
                  返回班级列表
                </button>
              )}
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {config.english} <span>/</span>{" "}
                    {group ? "CLASSROOM" : "WORKSPACE"}
                  </div>
                  <h1>
                    {group?.name || config.title}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>
                    {group
                      ? [group.grade, group.schedule]
                          .filter(Boolean)
                          .join(" · ") || "班级已就绪，开始添加你的学生。"
                      : config.description}
                  </p>
                </div>
                <div className="heading-actions">
                  {group ? (
                    <>
                      <button
                        className="button button-secondary"
                        onClick={() => setModal({ kind: "class", group })}
                      >
                        <Pencil size={16} />
                        编辑班级
                      </button>
                      <button
                        className="icon-button delete-class"
                        aria-label="删除班级"
                        onClick={() => deleteClass(group)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </>
                  ) : (
                    <button
                      className="button button-primary"
                      onClick={() =>
                        setModal({
                          kind:
                            route.module === "one-to-one" ? "student" : "class",
                        })
                      }
                    >
                      <Plus size={18} />
                      {route.module === "one-to-one" ? "添加学生" : "创建班级"}
                    </button>
                  )}
                </div>
              </div>
              {group && workspaceTabs()}
              {group?.notes && activePanel === "details" && (
                <p className="class-description">
                  <FileText size={16} />
                  {group.notes}
                </p>
              )}
              {!group && (
                <div className="stats-grid compact-stats">
                  <StatCard
                    label={group ? "班级学生" : "在册学生"}
                    value={listedStudents.length}
                    suffix="位"
                    icon={<Users size={22} />}
                    tone="green"
                  />
                  <StatCard
                    label={showStudentList ? "覆盖年级" : "教学班级"}
                    value={showStudentList ? grades.length : classes.length}
                    suffix={showStudentList ? "个年级" : "个班级"}
                    icon={<GraduationCap size={23} />}
                    tone="orange"
                  />
                  <StatCard
                    label="已保存课程反馈"
                    value={moduleFeedback.length}
                    suffix="次课程"
                    icon={<MessageSquareText size={22} />}
                    tone="purple"
                  />
                </div>
              )}
              {group && activePanel === "feedback" ? (
                listedStudents.length ? (
                  <FeedbackWorkspace
                    key={`class-${group.id}-${reloadAttempt}-${workspaceEpoch}`}
                    module={group.module}
                    students={listedStudents}
                    studentId={null}
                    classId={group.id}
                    className={group.name}
                    sessions={scopedFeedback}
                    onSave={saveFeedback}
                    onConfigureAI={() => setModal({ kind: "ai" })}
                    onDirtyChange={markFeedbackDirty}
                  />
                ) : (
                  <section className="content-card">
                    <EmptyState
                      icon={<Users size={32} />}
                      title="先添加学生，再填写班级反馈"
                      text="从 Excel 粘贴全班名单，之后就能在同一页面逐个填写反馈。"
                      action={
                        <div className="button-row">
                          <button
                            className="button button-primary"
                            onClick={() => setModal({ kind: "import" })}
                          >
                            <ArrowUpFromLine size={16} />
                            批量录入学生
                          </button>
                          <button
                            className="button button-secondary"
                            onClick={() => setModal({ kind: "student" })}
                          >
                            <Plus size={16} />
                            添加学生
                          </button>
                        </div>
                      }
                    />
                  </section>
                )
              ) : showStudentList ? (
                studentTable()
              ) : (
                <section className="class-section">
                  <div className="section-heading">
                    <div>
                      <h2>
                        我的班级{" "}
                        <span className="count-pill">{classes.length}</span>
                      </h2>
                      <p>选择班级，集中填写本次课程的学生反馈。</p>
                    </div>
                    <label className="search-input class-search">
                      <Search size={17} />
                      <input
                        aria-label="搜索班级"
                        placeholder="搜索班级、年级…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </label>
                  </div>
                  {filteredClasses.length ? (
                    <div className="class-grid">
                      {filteredClasses.map((c) => {
                        const members = data.students.filter(
                          (s) => s.classId === c.id,
                        );
                        return (
                          <button
                            className="class-card"
                            key={c.id}
                            onClick={() =>
                              navigate({ module: route.module, classId: c.id })
                            }
                          >
                            <div className="class-card-top">
                              <span
                                className={`class-icon tone-${config.color}`}
                              >
                                <config.icon size={23} />
                              </span>
                              <span className="badge">
                                {c.grade || "未设置年级"}
                              </span>
                              <ChevronRight size={18} />
                            </div>
                            <h3>{c.name}</h3>
                            <p>
                              <Clock3 size={14} />
                              {c.schedule || "暂未设置上课时间"}
                            </p>
                            <div className="class-card-bottom">
                              <span className="avatar-stack">
                                {members.slice(0, 3).map((s) => (
                                  <Avatar key={s.id} name={s.name} />
                                ))}
                                {!members.length && (
                                  <span className="no-students">
                                    <Users size={17} />
                                  </span>
                                )}
                              </span>
                              <span>{members.length} 位学生</span>
                              <span className="class-enter">
                                填写反馈 <ArrowRight size={14} />
                              </span>
                            </div>
                          </button>
                        );
                      })}
                      <button
                        className="new-class-card"
                        onClick={() => setModal({ kind: "class" })}
                      >
                        <span>
                          <Plus size={24} />
                        </span>
                        <strong>创建新班级</strong>
                        <small>开启一段新的教学旅程</small>
                      </button>
                    </div>
                  ) : (
                    <div className="content-card">
                      <EmptyState
                        icon={<LayoutGrid size={34} strokeWidth={1.3} />}
                        title={
                          query
                            ? "没有找到匹配的班级"
                            : `创建你的第一个${config.title}班级`
                        }
                        text={
                          query
                            ? "换个关键词试试看。"
                            : "先建立班级，再一次性录入全班学生，管理更轻松。"
                        }
                        action={
                          query ? (
                            <button
                              className="button button-secondary"
                              onClick={() => setQuery("")}
                            >
                              清空搜索
                            </button>
                          ) : (
                            <button
                              className="button button-primary"
                              onClick={() => setModal({ kind: "class" })}
                            >
                              <Plus size={16} />
                              创建班级
                            </button>
                          )
                        }
                      />
                    </div>
                  )}
                </section>
              )}
              {isEmpty && (
                <div className="getting-started">
                  <div>
                    <Sparkles size={18} />
                    <span>想先熟悉一下？用虚构示例体验完整工作流程。</span>
                  </div>
                  <button
                    onClick={async () => {
                      if (
                        await persist(
                          createDemoData(),
                          "已载入虚构示例，可在「数据与备份」中清空。",
                        )
                      )
                        setQuery("");
                    }}
                  >
                    体验示例 <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </>
          )}
          <footer className="main-footer">
            <span>
              <span className="online-dot" />
              {savedAt
                ? `已保存到 SQLite · ${savedAt}`
                : "本机 SQLite 数据库 · 建议定期备份"}
            </span>
            <span>
              Nookmi <span className="footer-dot">·</span> 留心每一次成长
            </span>
          </footer>
        </main>
      </div>
      <input
        type="file"
        ref={backupInput}
        accept=".json,application/json"
        className="sr-only"
        aria-label="选择备份文件"
        onChange={(e) => void readBackup(e.target.files?.[0])}
      />
      {modal?.kind === "student" && (
        <Modal
          title={modal.student ? "编辑学生资料" : "添加学生"}
          subtitle={
            group ? `录入至 ${group.name}` : "为学生建立专属的教学档案。"
          }
          onClose={() => setModal(null)}
        >
          <StudentForm
            initial={modal.student}
            defaultGrade={group?.grade}
            onSubmit={(fields) => saveStudent(fields, modal.student)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
      {modal?.kind === "class" && (
        <Modal
          title={modal.group ? "编辑班级" : `创建${config.title}班级`}
          subtitle="先建立一个班级，再添加或批量录入学生。"
          onClose={() => setModal(null)}
        >
          <ClassForm
            initial={modal.group}
            onSubmit={(fields) => saveClass(fields, modal.group)}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
      {modal?.kind === "import" && (
        <Modal
          title="批量录入学生"
          subtitle={
            group
              ? `录入至 ${group.name} · ${config.title}`
              : "录入至一对一学生名单"
          }
          wide
          onClose={() => setModal(null)}
        >
          <ImportStudents
            existing={listedStudents}
            defaultGrade={group?.grade}
            onSubmit={importStudents}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
      {modal?.kind === "note" && student && (
        <Modal
          title="添加教学记录"
          subtitle={`记录 ${student.name} 的学习与成长`}
          onClose={() => setModal(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!noteContent.trim() || !noteDate) return;
              if (
                await persist(
                  {
                    ...data,
                    records: [
                      ...data.records,
                      {
                        id: newId(),
                        studentId: student.id,
                        date: noteDate,
                        content: noteContent.trim(),
                        createdAt: new Date().toISOString(),
                      },
                    ],
                  },
                  "教学记录已保存",
                )
              )
                setModal(null);
            }}
          >
            <label className="field">
              记录日期
              <input
                type="date"
                required
                min="1900-01-01"
                max="2100-12-31"
                value={noteDate}
                onChange={(e) => setNoteDate(e.target.value)}
              />
            </label>
            <label className="field note-field">
              教学内容与安排
              <textarea
                rows={7}
                required
                maxLength={5000}
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="例如：今天学习了一元一次方程，移项时还容易忘记变号。下次课先做 5 道针对练习…"
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setModal(null)}
              >
                取消
              </button>
              <button
                type="submit"
                className="button button-primary"
                disabled={!noteContent.trim()}
              >
                保存记录
              </button>
            </div>
          </form>
        </Modal>
      )}
      {modal?.kind === "backup" && (
        <Modal
          title="数据与备份"
          subtitle="你的教学资料，由你保管。"
          onClose={() => setModal(null)}
        >
          <div className="backup-notice">
            <ShieldCheck size={23} />
            <p>
              学生资料、简短记录和反馈保存在项目的
              .local/nookmi.sqlite3。连接同一个本地后端的浏览器共用这份数据。请定期导出备份；AI
              密钥不会进入备份。
            </p>
          </div>
          <div className="backup-summary">
            <span>
              <strong>{data.classes.length}</strong>个班级
            </span>
            <span>
              <strong>{data.students.length}</strong>位学生
            </span>
            <span>
              <strong>{data.records.length}</strong>条教学记录
            </span>
            <span>
              <strong>{feedbackSessions.length}</strong>次课程反馈
            </span>
          </div>
          <button
            className="backup-option"
            onClick={exportBackup}
            disabled={!ready}
          >
            <span className="stat-icon tone-green">
              <ArrowDownToLine size={22} />
            </span>
            <span>
              <strong>导出完整备份</strong>
              <small>保存学生资料、课程反馈和教学记录为 JSON 文件</small>
            </span>
            <ChevronRight size={18} />
          </button>
          {(legacy.data.students.length > 0 ||
            legacy.data.classes.length > 0) && (
            <button
              className="backup-option"
              onClick={() =>
                download(
                  JSON.stringify(legacy.data, null, 2),
                  `nookmi-legacy-${localDate()}.json`,
                )
              }
            >
              <span className="stat-icon tone-green">
                <Database size={22} />
              </span>
              <span>
                <strong>下载旧版浏览器副本</strong>
                <small>保留更新前的数据，需要时通过备份恢复</small>
              </span>
              <ChevronRight size={18} />
            </button>
          )}
          <button className="backup-option" onClick={reloadDatabase}>
            <span className="stat-icon tone-green">
              <Database size={22} />
            </span>
            <span>
              <strong>重新读取数据库</strong>
              <small>读取其他页面已保存的最新资料</small>
            </span>
            <ChevronRight size={18} />
          </button>
          <button
            className="backup-option"
            disabled={!ready}
            onClick={() => backupInput.current?.click()}
          >
            <span className="stat-icon tone-purple">
              <ArrowUpFromLine size={22} />
            </span>
            <span>
              <strong>从备份恢复</strong>
              <small>导入 JSON 备份，将替换当前所有数据</small>
            </span>
            <ChevronRight size={18} />
          </button>
          <div className="backup-danger">
            <span>需要从头开始？</span>
            <button
              className="button button-ghost danger-text button-sm"
              disabled={!ready}
              onClick={() => {
                setModal(null);
                setConfirmation({
                  title: "清空全部数据？",
                  message:
                    "这会删除三个模块的全部班级、学生、课程反馈和教学记录，无法撤销。请确认已保存需要的备份。",
                  label: "清空全部数据",
                  danger: true,
                  action: async () => {
                    if (
                      await persist(
                        {
                          schemaVersion: 1,
                          classes: [],
                          students: [],
                          records: [],
                        },
                        "全部数据已清空",
                      )
                    ) {
                      setConfirmation(null);
                      feedbackDirty.current = false;
                      setWorkspaceEpoch((value) => value + 1);
                      navigate({ module: "one-to-one" });
                    }
                  },
                });
              }}
            >
              清空工作台
            </button>
          </div>
        </Modal>
      )}
      {modal?.kind === "ai" && <AISettings onClose={() => setModal(null)} />}
      {confirmation && (
        <Modal title={confirmation.title} onClose={() => setConfirmation(null)}>
          <p className="confirm-message">{confirmation.message}</p>
          <div className="form-actions">
            <button
              className="button button-secondary"
              onClick={() => setConfirmation(null)}
            >
              取消
            </button>
            <button
              className={`button ${confirmation.danger ? "button-danger" : "button-primary"}`}
              onClick={confirmation.action}
            >
              {confirmation.label || "确认"}
            </button>
          </div>
        </Modal>
      )}
      {manualCopy !== null && (
        <Modal
          title="手动复制反馈"
          subtitle="浏览器暂时无法自动复制，请选中以下内容后复制。"
          onClose={() => setManualCopy(null)}
        >
          <label className="field">
            反馈内容
            <textarea
              readOnly
              rows={10}
              value={manualCopy}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <div className="form-actions">
            <button
              className="button button-primary"
              onClick={() => setManualCopy(null)}
            >
              完成
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "toast-error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <X size={18} /> : <Check size={18} />}
          <span>{toast.message}</span>
          <button aria-label="关闭提示" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {saving && (
        <div className="saving-shield" role="status" aria-live="polite">
          <div>正在保存到本机数据库…</div>
        </div>
      )}
    </div>
  );
}
