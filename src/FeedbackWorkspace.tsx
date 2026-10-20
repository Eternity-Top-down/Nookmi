import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  CheckCheck,
  Clock3,
  Copy,
  FileText,
  Plus,
  Save,
} from "lucide-react";
import { Modal } from "./components";
import { newId } from "./data";
import {
  copyFeedbackText,
  currentLocalLessonAt,
  formatClassFeedback,
  formatLessonAt,
  formatStudentFeedback,
  isValidLessonAt,
} from "./feedback";
import type { FeedbackSession, ModuleId, Student } from "./types";
import "./feedback.css";

interface FeedbackWorkspaceProps {
  module: ModuleId;
  students: Student[];
  classId: string | null;
  studentId: string | null;
  className?: string;
  sessions: FeedbackSession[];
  onSave: (session: FeedbackSession) => boolean;
  onDirtyChange?: (dirty: boolean) => void;
  readonly?: boolean;
}

interface Draft {
  id: string | null;
  lessonAt: string;
  values: Record<string, string>;
  createdAt: string | null;
}

function studentValue(draft: Draft, id: string): string {
  return Object.hasOwn(draft.values, id) ? draft.values[id] : "";
}

function sessionDraft(session?: FeedbackSession): Draft {
  return session
    ? {
        id: session.id,
        lessonAt: session.lessonAt,
        values: Object.fromEntries(
          session.entries.map((entry) => [entry.studentId, entry.content]),
        ),
        createdAt: session.createdAt,
      }
    : {
        id: null,
        lessonAt: currentLocalLessonAt(),
        values: {},
        createdAt: null,
      };
}

export default function FeedbackWorkspace({
  module,
  students,
  classId,
  studentId,
  className,
  sessions,
  onSave,
  onDirtyChange,
  readonly = false,
}: FeedbackWorkspaceProps) {
  const orderedSessions = useMemo(
    () =>
      [...sessions].sort(
        (a, b) =>
          b.lessonAt.localeCompare(a.lessonAt) ||
          b.updatedAt.localeCompare(a.updatedAt),
      ),
    [sessions],
  );
  const [draft, setDraft] = useState(() => sessionDraft(orderedSessions[0]));
  const [baseline, setBaseline] = useState(draft);
  const [status, setStatus] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [pendingSession, setPendingSession] = useState<{
    session?: FeedbackSession;
  } | null>(null);
  const [copyFallback, setCopyFallback] = useState<{
    text: string;
    reason: string;
  } | null>(null);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [copying, setCopying] = useState(false);
  const loadedSignature = useRef(
    orderedSessions[0] ? JSON.stringify(orderedSessions[0]) : "",
  );
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const fieldId = useId();
  const dirty =
    !readonly &&
    (draft.lessonAt !== baseline.lessonAt ||
      students.some(
        (student) =>
          studentValue(draft, student.id) !==
          studentValue(baseline, student.id),
      ));
  const filledCount = students.filter((student) =>
    studentValue(draft, student.id).trim(),
  ).length;

  useEffect(() => {
    dirtyCallback.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => dirtyCallback.current?.(false), []);

  function loadSession(session?: FeedbackSession) {
    const next = sessionDraft(session);
    setDraft(next);
    setBaseline(next);
    loadedSignature.current = session ? JSON.stringify(session) : "";
    setStatus(null);
    setPendingSession(null);
  }

  useEffect(() => {
    if (dirty || !draft.id) return;
    const latest = sessions.find((session) => session.id === draft.id);
    const signature = latest ? JSON.stringify(latest) : "";
    if (signature !== loadedSignature.current) {
      loadSession(latest ?? orderedSessions[0]);
    }
  }, [sessions, orderedSessions, draft.id, dirty]);

  function requestSession(session?: FeedbackSession) {
    if (session?.id === draft.id) return;
    if (dirty) setPendingSession({ session });
    else loadSession(session);
  }

  function currentSession(): FeedbackSession {
    const now = new Date().toISOString();
    return {
      id: draft.id ?? newId(),
      module,
      classId,
      studentId,
      lessonAt: draft.lessonAt,
      entries: students.map((student) => ({
        studentId: student.id,
        content: studentValue(draft, student.id).trim(),
      })),
      createdAt: draft.createdAt ?? now,
      updatedAt: now,
    };
  }

  function validTime() {
    if (isValidLessonAt(draft.lessonAt)) return true;
    setStatus({
      text: "请填写有效的上课日期和时间（1900—2100 年）。",
      error: true,
    });
    return false;
  }

  function save() {
    if (readonly || !validTime() || !filledCount) return;
    const session = currentSession();
    if (session.entries.some((entry) => entry.content.length > 10000)) {
      setStatus({ text: "每位学生的反馈不能超过 10000 字。", error: true });
      return;
    }
    if (onSave(session)) {
      const next = sessionDraft(session);
      setDraft(next);
      setBaseline(next);
      loadedSignature.current = JSON.stringify(session);
      setStatus({
        text: `本次反馈已保存，已填写 ${filledCount} 位学生。`,
      });
    } else {
      setStatus({
        text: "反馈尚未保存，请按页面提示处理后重试。当前输入仍保留在这里。",
        error: true,
      });
    }
  }

  async function copy(student?: Student) {
    if (!validTime()) return;
    const session = currentSession();
    const text = student
      ? formatStudentFeedback(session, student, className)
      : formatClassFeedback(session, students, className);
    if (!text) return;
    setCopying(true);
    try {
      await copyFeedbackText(text);
      setStatus({
        text: student
          ? `已复制 ${student.name} 的反馈。`
          : `已复制 ${filledCount} 位学生的反馈，空白内容已跳过。`,
      });
    } catch (error) {
      setCopyFallback({
        text,
        reason:
          error instanceof Error
            ? error.message
            : "自动复制失败，请手动选择并复制。",
      });
    } finally {
      setCopying(false);
    }
  }

  return (
    <section className="fb-workspace" aria-label="课后反馈工作区">
      <div className="fb-heading">
        <div>
          <span className="fb-eyebrow">AFTER CLASS</span>
          <h2>课后反馈</h2>
          <p>
            {module === "one-to-one"
              ? "写下本次上课反馈，复制后即可发给家长。"
              : "填写上课时间，为每位学生写下这次的反馈。"}
          </p>
        </div>
        {!readonly && (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => requestSession()}
          >
            <Plus size={17} />
            新建本次反馈
          </button>
        )}
      </div>
      <div className="fb-layout">
        <div className="fb-editor">
          <div className="fb-session-bar">
            <label className="field fb-time-field" htmlFor={`${fieldId}-time`}>
              <span>
                <CalendarDays size={16} />
                上课时间
              </span>
              <input
                id={`${fieldId}-time`}
                type="datetime-local"
                value={draft.lessonAt}
                min="1900-01-01T00:00"
                max="2100-12-31T23:59"
                required
                readOnly={readonly}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    lessonAt: event.target.value,
                  }));
                  setStatus(null);
                }}
              />
            </label>
            <div className="fb-progress" aria-live="polite">
              <span className={`fb-draft-badge ${dirty ? "fb-unsaved" : ""}`}>
                {dirty ? "有未保存修改" : draft.id ? "已保存记录" : "新反馈"}
              </span>
              <span>
                <strong>{filledCount}</strong> / {students.length} 人已填写
              </span>
            </div>
          </div>
          {status && (
            <div
              className={`fb-status ${status.error ? "fb-status-error" : ""}`}
              role={status.error ? "alert" : "status"}
            >
              {!status.error && <Check size={16} />}
              {status.text}
            </div>
          )}
          {students.length ? (
            <div className="fb-students">
              {students.map((student, index) => {
                const value = studentValue(draft, student.id);
                const filled = Boolean(value.trim());
                return (
                  <article className="fb-student" key={student.id}>
                    <div className="fb-student-heading">
                      <div className="fb-student-identity">
                        <span className="fb-student-number">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <div>
                          <label htmlFor={`${fieldId}-${student.id}`}>
                            {student.name}
                          </label>
                          <span>
                            {[student.grade, student.school]
                              .filter(Boolean)
                              .join(" · ") || "学生反馈"}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="button button-ghost button-sm"
                        aria-label={`复制 ${student.name} 的反馈`}
                        disabled={!filled || copying}
                        onClick={() => void copy(student)}
                      >
                        <Copy size={15} />
                        复制反馈
                      </button>
                    </div>
                    <textarea
                      id={`${fieldId}-${student.id}`}
                      value={value}
                      maxLength={10000}
                      rows={module === "one-to-one" ? 9 : 5}
                      readOnly={readonly}
                      placeholder="自由填写这位学生本次上课的反馈…"
                      onChange={(event) => {
                        const content = event.target.value;
                        setDraft((current) => ({
                          ...current,
                          values: { ...current.values, [student.id]: content },
                        }));
                        setStatus(null);
                      }}
                    />
                    <div className="fb-student-footer">
                      <span className={filled ? "fb-filled" : ""}>
                        {filled ? (
                          <>
                            <CheckCheck size={14} />
                            已填写
                          </>
                        ) : (
                          "待填写"
                        )}
                      </span>
                      <span>{value.length} / 10000</span>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="fb-empty">
              <FileText size={30} />
              <h3>先为班级添加学生</h3>
              <p>学生名单建立后，就可以在这里逐一填写课后反馈。</p>
            </div>
          )}
          <div className="fb-savebar">
            <p>
              {readonly
                ? "复制反馈后，可粘贴发送给对应家长。"
                : "可以先保存已填写的反馈，稍后继续补充。"}
            </p>
            <div>
              {module !== "one-to-one" && (
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={!filledCount || copying}
                  onClick={() => void copy()}
                >
                  <Copy size={16} />
                  复制全班反馈
                </button>
              )}
              {!readonly && (
                <button
                  type="button"
                  className="button button-primary"
                  disabled={!filledCount || (!dirty && Boolean(draft.id))}
                  onClick={save}
                >
                  <Save size={16} />
                  保存本次反馈
                </button>
              )}
            </div>
          </div>
        </div>
        <aside className="fb-history" aria-label="反馈历史">
          <div className="fb-history-heading">
            <h3>
              <Clock3 size={17} />
              历史反馈
            </h3>
            <span>{orderedSessions.length} 次</span>
          </div>
          {orderedSessions.length ? (
            <>
              <div className="fb-history-list">
                {orderedSessions.slice(0, historyLimit).map((session) => {
                  const filled = session.entries.filter((entry) =>
                    entry.content.trim(),
                  ).length;
                  return (
                    <button
                      key={session.id}
                      type="button"
                      className={`fb-history-item ${session.id === draft.id ? "fb-history-active" : ""}`}
                      aria-current={
                        session.id === draft.id ? "true" : undefined
                      }
                      onClick={() => requestSession(session)}
                    >
                      <strong>{formatLessonAt(session.lessonAt)}</strong>
                      <span>
                        已填写 {filled} / {session.entries.length} 人
                      </span>
                    </button>
                  );
                })}
              </div>
              {orderedSessions.length > historyLimit && (
                <button
                  type="button"
                  className="button button-ghost button-sm fb-more"
                  onClick={() => setHistoryLimit((limit) => limit + 20)}
                >
                  查看更早的反馈
                </button>
              )}
            </>
          ) : (
            <div className="fb-history-empty">
              <FileText size={25} />
              <p>还没有保存过反馈</p>
              <span>保存后，可在这里查看和继续编辑。</span>
            </div>
          )}
        </aside>
      </div>
      {pendingSession && (
        <Modal
          title="放弃当前未保存的修改？"
          onClose={() => setPendingSession(null)}
        >
          <p className="confirm-message">
            当前反馈有未保存的内容。返回后可以先保存；继续切换将丢弃这些修改。
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setPendingSession(null)}
            >
              返回编辑
            </button>
            <button
              type="button"
              className="button button-danger"
              onClick={() => loadSession(pendingSession.session)}
            >
              放弃修改并继续
            </button>
          </div>
        </Modal>
      )}
      {copyFallback && (
        <Modal
          title="手动复制反馈"
          subtitle={copyFallback.reason}
          wide
          onClose={() => setCopyFallback(null)}
        >
          <label className="field">
            待复制的反馈
            <textarea
              className="fb-copy-fallback"
              readOnly
              rows={12}
              value={copyFallback.text}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <p className="field-hint">
            选中文字后，按 Ctrl+C（Mac 按 ⌘C），或使用设备的复制菜单。
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => setCopyFallback(null)}
            >
              完成
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
