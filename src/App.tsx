import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpFromLine,
  BookOpen,
  Check,
  ChevronRight,
  ClipboardList,
  Clock3,
  Database,
  FileText,
  GraduationCap,
  LayoutGrid,
  Leaf,
  Menu,
  Moon,
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
import {
  createDemoData,
  EMPTY_DATA,
  loadData,
  newId,
  parseBackup,
  saveData,
} from "./data";
import { parseRoute, routeUrl, type Route } from "./routes";
import {
  type AppData,
  type ClassGroup,
  type ModuleId,
  type Student,
  type StudentFields,
} from "./types";

const MODULES = {
  "one-to-one": {
    title: "一对一",
    english: "ONE-ON-ONE",
    description: "关注每个学生的节奏，让个性化教学从这里开始。",
    icon: UserRound,
    color: "green",
  },
  evening: {
    title: "晚辅",
    english: "EVENING STUDY",
    description: "把班级有序安排，让每一晚的陪伴更有方向。",
    icon: Moon,
    color: "purple",
  },
  course: {
    title: "班课",
    english: "GROUP CLASSES",
    description: "从一个班级出发，记录每位学生的学习与成长。",
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
  const [initial] = useState(loadData);
  const [data, setData] = useState<AppData>(initial.data);
  const [storageError, setStorageError] = useState(initial.error);
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
  const backupInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onHash = () => {
      setRoute(getRoute());
      setQuery("");
      setGradeFilter("");
      setSidebarOpen(false);
      setModal(null);
      setConfirmation(null);
    };
    window.addEventListener("hashchange", onHash);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== "nookmi:data:v1" && event.key !== null) return;
      const result = loadData();
      setData(result.data);
      setStorageError(result.error);
      setModal(null);
      setConfirmation(null);
      setToast({ message: "已同步此浏览器其他页面中的最新数据。" });
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("storage", onStorage);
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
  const moduleRecords = data.records.filter((r) =>
    moduleStudents.some((s) => s.id === r.studentId),
  );
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

  function persist(next: AppData, message: string, recovery = false) {
    if (storageError && !recovery) {
      setToast({
        message: "请先处理本地数据读取问题，避免覆盖原有数据。",
        error: true,
      });
      return false;
    }
    try {
      saveData(next);
      setData(next);
      setStorageError(null);
      setSavedAt(
        new Date().toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      setToast({ message });
      return true;
    } catch (error) {
      setToast({
        message:
          error instanceof Error
            ? error.message
            : "保存失败，请导出备份后重试。",
        error: true,
      });
      return false;
    }
  }
  function saveStudent(fields: StudentFields, editing?: Student) {
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
      persist(
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
  function saveClass(
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
      persist(
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
  function importStudents(fields: StudentFields[]) {
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
      persist(
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
        "该学生的个人信息和教学记录会一并删除。此操作无法撤销，建议先导出数据备份。",
      label: "确认删除",
      danger: true,
      action: () => {
        if (
          persist(
            {
              ...data,
              students: data.students.filter((s) => s.id !== target.id),
              records: data.records.filter((r) => r.studentId !== target.id),
            },
            "学生已删除",
          )
        ) {
          setConfirmation(null);
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
      message: `班级内 ${ids.size} 位学生及其教学记录会一并删除。此操作无法撤销，建议先导出数据备份。`,
      label: "删除班级及学生",
      danger: true,
      action: () => {
        if (
          persist(
            {
              ...data,
              classes: data.classes.filter((c) => c.id !== target.id),
              students: data.students.filter((s) => !ids.has(s.id)),
              records: data.records.filter((r) => !ids.has(r.studentId)),
            },
            "班级已删除",
          )
        ) {
          setConfirmation(null);
          navigate({ module: route.module });
        }
      },
    });
  }
  function exportBackup() {
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
        message: `备份包含 ${restored.classes.length} 个班级、${restored.students.length} 位学生、${restored.records.length} 条教学记录。恢复将替换当前所有模块的数据；建议先导出现有备份。`,
        label: "确认替换并恢复",
        action: () => {
          if (persist(restored, "数据备份已恢复", true)) {
            setConfirmation(null);
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
                ? "班级里的每一个名字，都有专属的成长空间。"
                : "点击学生，进入专属教学空间。"}
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
                    <th>教学记录</th>
                    <th>
                      <span className="sr-only">操作</span>
                    </th>
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
                            data.records.filter((r) => r.studentId === s.id)
                              .length
                          }{" "}
                          条
                        </span>
                      </td>
                      <td>
                        <span className="row-arrow">
                          <ArrowRight size={17} />
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
                数据保存在当前浏览器
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
              <small>个人工作台 · v0.1.0</small>
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
              数学教学
            </span>
          </div>
        </header>
        <main>
          {storageError ? (
            <section className="content-card recovery-card">
              <Database size={36} />
              <h1>本地数据需要处理</h1>
              <p>{storageError}</p>
              <p>原始数据已保留。可以先下载原始内容，或恢复一份有效备份。</p>
              <div className="button-row">
                <button
                  className="button button-secondary"
                  onClick={() => {
                    try {
                      download(
                        localStorage.getItem("nookmi:data:v1") || "",
                        `nookmi-recovery-${localDate()}.txt`,
                        "text/plain",
                      );
                    } catch {
                      setToast({
                        message: "浏览器不允许读取本地存储。",
                        error: true,
                      });
                    }
                  }}
                >
                  下载原始数据
                </button>
                <button
                  className="button button-primary"
                  onClick={() => backupInput.current?.click()}
                >
                  恢复备份
                </button>
                <button
                  className="button button-ghost danger-text"
                  onClick={() =>
                    setConfirmation({
                      title: "清空无法读取的本地数据？",
                      message:
                        "这将覆盖原始数据。请先下载原始数据，保留恢复机会。",
                      label: "清空并重新开始",
                      danger: true,
                      action: () => {
                        if (
                          persist(
                            {
                              ...EMPTY_DATA,
                              students: [],
                              classes: [],
                              records: [],
                            },
                            "已重新开始",
                            true,
                          )
                        )
                          setConfirmation(null);
                      },
                    })
                  }
                >
                  重新开始
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
                                  action: () => {
                                    if (
                                      persist(
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
              {!group && (
                <section className={`welcome-banner banner-${config.color}`}>
                  <div className="welcome-copy">
                    <span className="welcome-kicker">
                      <span />
                      让教学，井井有条
                    </span>
                    <h2>
                      {route.module === "one-to-one"
                        ? "每一个学生，都有自己的成长节奏。"
                        : route.module === "evening"
                          ? "一份有序的名单，一晚安心的陪伴。"
                          : "一起学习，也看见每一个人。"}
                    </h2>
                    <p>
                      {route.module === "one-to-one"
                        ? "学生档案、学情备注、教学记录，在一个地方轻松管理。"
                        : "创建班级 · 批量录入学生 · 进入个人教学空间"}
                    </p>
                  </div>
                  <div className="math-art" aria-hidden="true">
                    <div className="art-grid" />
                    <span className="formula formula-a">y = x²</span>
                    <svg viewBox="0 0 220 130">
                      <path
                        d="M25 105H205M110 120V15"
                        stroke="currentColor"
                        opacity=".3"
                        fill="none"
                      />
                      <path
                        d="M53 25Q110 184 167 25"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      />
                      <circle cx="110" cy="104" r="4" fill="currentColor" />
                      <path
                        d="m199 101 6 4-6 4m-93-88 4-6 4 6"
                        fill="none"
                        stroke="currentColor"
                      />
                    </svg>
                    <span className="formula formula-b">a² + b² = c²</span>
                    <span className="art-spark">✦</span>
                  </div>
                </section>
              )}
              {group?.notes && (
                <p className="class-description">
                  <FileText size={16} />
                  {group.notes}
                </p>
              )}
              <div className="stats-grid">
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
                  label="教学记录"
                  value={
                    group
                      ? data.records.filter((r) =>
                          listedStudents.some((s) => s.id === r.studentId),
                        ).length
                      : moduleRecords.length
                  }
                  suffix="条记录"
                  icon={<ClipboardList size={22} />}
                  tone="purple"
                />
              </div>
              {showStudentList ? (
                studentTable()
              ) : (
                <section className="class-section">
                  <div className="section-heading">
                    <div>
                      <h2>
                        我的班级{" "}
                        <span className="count-pill">{classes.length}</span>
                      </h2>
                      <p>选择一个班级，查看和管理学生。</p>
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
                                进入班级 <ArrowRight size={14} />
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
                    onClick={() => {
                      if (
                        persist(
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
              {savedAt ? `已保存 · ${savedAt}` : "本地存储 · 建议定期备份"}
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
            onSubmit={(e) => {
              e.preventDefault();
              if (!noteContent.trim() || !noteDate) return;
              if (
                persist(
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
              数据仅保存在当前设备的当前浏览器中。更换浏览器、清理网站数据后不会自动恢复。请定期导出备份。
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
          </div>
          <button className="backup-option" onClick={exportBackup}>
            <span className="stat-icon tone-green">
              <ArrowDownToLine size={22} />
            </span>
            <span>
              <strong>导出完整备份</strong>
              <small>保存所有模块、学生资料和教学记录为 JSON 文件</small>
            </span>
            <ChevronRight size={18} />
          </button>
          <button
            className="backup-option"
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
              onClick={() => {
                setModal(null);
                setConfirmation({
                  title: "清空全部数据？",
                  message:
                    "这会删除三个模块的全部班级、学生和教学记录，无法撤销。请确认已保存需要的备份。",
                  label: "清空全部数据",
                  danger: true,
                  action: () => {
                    if (
                      persist(
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
    </div>
  );
}
