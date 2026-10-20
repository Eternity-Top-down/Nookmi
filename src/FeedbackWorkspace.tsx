import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Check,
  CheckCheck,
  ChevronRight,
  Clock3,
  Copy,
  FileText,
  LoaderCircle,
  Plus,
  Save,
  Settings2,
  Sparkles,
  Square,
  WandSparkles,
} from "lucide-react";
import { ApiError, generateFeedback } from "./api";
import { Modal } from "./components";
import FeedbackStyleReference from "./FeedbackStyleReference";
import { feedbackDraftScope, readFeedbackDrafts, writeFeedbackDraft, removeFeedbackDraft, type FeedbackDraftRecord } from "./feedbackDrafts";
import { newId } from "./data";
import {
  copyFeedbackText,
  currentLocalLessonAt,
  formatClassFeedback,
  formatFeedbackPeriod,
  formatStudentFeedback,
} from "./feedback";
import {
  canApplyGeneration,
  defaultBrief,
  emptyObservations,
  entryIsStale,
  feedbackSnapshot,
  feedbackInputErrors,
  generationSignature,
  hasFeedbackContent,
  hasObservations,
  hasPersonalFacts,
  normalizeObservations,
  normalizeOneToOneTasks,
  outlineFeedback,
  sortFeedbackByRecentEdit,
} from "./feedbackModel";
import type {
  FeedbackBrief,
  FeedbackEntry,
  FeedbackSession,
  ModuleId,
  Student,
  StudentObservations,
} from "./types";
import "./feedback.css";

interface FeedbackWorkspaceProps {
  module: ModuleId;
  students: Student[];
  classId: string | null;
  studentId: string | null;
  className?: string;
  sessions: FeedbackSession[];
  onSave: (session: FeedbackSession, automatic?: boolean) => Promise<boolean>;
  autoSaveBlocked?: boolean;
  styleReference?: string;
  onSaveStyle?: (reference: string) => Promise<boolean>;
  onDirtyChange?: (dirty: boolean) => void;
  onConfigureAI?: () => void;
  readonly?: boolean;
}
type Notice = { text: string; error?: boolean } | null;
type Revision = { epoch: number; context: number; entry: number };
type Proposal = {
  student: Student;
  content: string;
  source: "ai" | "outline";
  signature: string;
  revision: Revision;
};
type Confirmation = {
  title: string;
  message: string;
  label: string;
  action: () => void;
} | null;
type Progress = {
  total: number;
  completed: number;
  success: number;
  failed: number;
  skipped: number;
  name: string;
};
const OBSERVATION_FIELDS: {
  key: Exclude<keyof StudentObservations, "subjects">;
  label: string;
  placeholder: string;
}[] = [
  {
    key: "performance",
    label: "本次情况",
    placeholder: "完成了什么、参与情况如何？短句即可。",
  },
  {
    key: "strengths",
    label: "值得肯定",
    placeholder: "你实际观察到的进步或做得好的地方",
  },
  {
    key: "difficulties",
    label: "需要关注",
    placeholder: "具体卡在哪里、有什么反复出现的问题",
  },
  {
    key: "plan",
    label: "下一步建议",
    placeholder: "你希望继续练习或请家长配合什么（选填）",
  },
];
function entryFor(session: FeedbackSession, id: string): FeedbackEntry {
  return (
    session.entries.find((entry) => entry.studentId === id) ?? {
      studentId: id,
      content: "",
      observations: emptyObservations(),
      reviewed: false,
      generationSource: "manual",
    }
  );
}
function sourceSignature(session: FeedbackSession, student: Student, styleReference = "") {
  return generationSignature(
    session.module,
    session.brief!,
    normalizeObservations(entryFor(session, student.id).observations),
    student.grade,
    session.lessonAt,
    styleReference,
  );
}
function makeDraft(
  module: ModuleId,
  students: Student[],
  classId: string | null,
  studentId: string | null,
  saved?: FeedbackSession,
): FeedbackSession {
  const now = new Date().toISOString();
  const brief = saved?.brief
    ? structuredClone(saved.brief)
    : defaultBrief(
        module,
        students.map((student) => student.grade),
        saved ? new Date(saved.lessonAt) : new Date(),
      );
  return normalizeOneToOneTasks({
    ...(saved ?? {
      id: newId(),
      module,
      classId,
      studentId,
      lessonAt:
        module === "one-to-one"
          ? currentLocalLessonAt()
          : `${brief.periodStart}T00:00`,
      createdAt: now,
      updatedAt: now,
    }),
    brief,
    entries: students.map((student) => {
      const prior = saved?.entries.find(
        (entry) => entry.studentId === student.id,
      );
      return {
        ...(prior ?? {
          studentId: student.id,
          content: "",
          reviewed: false,
          generationSource: "manual" as const,
        }),
        observations: normalizeObservations(prior?.observations),
      };
    }),
  });
}
export default function FeedbackWorkspace({
  module,
  students,
  classId,
  studentId,
  className,
  sessions,
  onSave,
  styleReference = "",
  onSaveStyle,
  onDirtyChange,
  onConfigureAI,
  readonly = false,
  autoSaveBlocked = false,
}: FeedbackWorkspaceProps) {
  const orderedSessions = useMemo(
    () => sortFeedbackByRecentEdit(sessions),
    [sessions],
  );
  const scope = feedbackDraftScope(module, classId, studentId);
  const [initial] = useState(() => {
    const cached = readFeedbackDrafts(scope);
    const record = readonly ? undefined : cached.drafts.find((item) =>
      feedbackSnapshot(item.session) !== item.baselineSnapshot || sessions.some((session) => session.id === item.session.id));
    const remote = record ? sessions.find((session) => session.id === record.session.id) : orderedSessions[0];
    const remoteDraft = remote ? makeDraft(module, students, classId, studentId, remote) : undefined;
    const remoteSnapshot = remoteDraft ? feedbackSnapshot(remoteDraft) : "";
    const pending = record && feedbackSnapshot(record.session) !== record.baselineSnapshot;
    const alreadySaved = record && remoteSnapshot === feedbackSnapshot(record.session);
    const restored = record && (pending || remoteSnapshot === record.baselineSnapshot);
    const session = restored ? makeDraft(module, students, classId, studentId, record.session)
      : remoteDraft ?? makeDraft(module, students, classId, studentId, orderedSessions[0]);
    return {
      session, baseline: restored ? alreadySaved ? remoteSnapshot : record.baselineSnapshot : remote ? feedbackSnapshot(session) : "",
      selectedId: restored && students.some((student) => student.id === record.selectedId) ? record.selectedId : students[0]?.id ?? "",
      subjectText: restored ? record.subjectText : session.brief!.subjects.join("、"),
      restored: Boolean(restored && pending && !alreadySaved), conflict: Boolean(restored && pending && !alreadySaved && remoteSnapshot !== record.baselineSnapshot),
      drafts: cached.drafts.map((item) => {
        const saved = sessions.find((entry) => entry.id === item.session.id);
        const snapshot = saved ? feedbackSnapshot(makeDraft(module, students, classId, studentId, saved)) : "";
        return snapshot === feedbackSnapshot(item.session) ? { ...item, baselineSnapshot: snapshot } : item;
      }), error: cached.error,
      remoteSignature: remote ? JSON.stringify(remote) : "",
    };
  });
  const [draft, setDraft] = useState(initial.session);
  const [baseline, setBaseline] = useState(initial.baseline);
  const baselineRef = useRef(baseline);
  const [selectedId, setSelectedId] = useState(initial.selectedId);
  const [subjectText, setSubjectText] = useState(
    initial.subjectText,
  );
  const [status, setStatus] = useState<Notice>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [copyFallback, setCopyFallback] = useState<{
    text: string;
    reason: string;
  } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failures, setFailures] = useState(new Map<string, string>());
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [needsConfiguration, setNeedsConfiguration] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [styleDirty, setStyleDirty] = useState(false);
  const [localDrafts, setLocalDrafts] = useState(initial.drafts);
  const [localError, setLocalError] = useState(initial.error);
  const [recoveryConflict, setRecoveryConflict] = useState(initial.conflict);
  const [autoSaveError, setAutoSaveError] = useState(false);
  const saveLock = useRef(false);
  const subjectTextRef = useRef(subjectText);
  const selectedIdRef = useRef(selectedId);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const styleRef = useRef(styleReference);
  const draftRef = useRef(draft);
  const studentsRef = useRef(students);
  studentsRef.current = students;
  const epoch = useRef(0);
  const contextVersion = useRef(0);
  const entryVersions = useRef(new Map<string, number>());
  const generationId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const loadedSignature = useRef(
    initial.remoteSignature,
  );
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const rosterSignature = useRef(
    new Map(
      students.map((student) => [
        student.id,
        `${student.name}\0${student.grade}`,
      ]),
    ),
  );
  const fieldId = useId();
  const dirty = !readonly && feedbackSnapshot(draft) !== baseline &&
    (baseline !== "" || hasFeedbackContent(draft) || localDrafts.some((item) => item.session.id === draft.id));
  const selected =
    students.find((student) => student.id === selectedId) ?? students[0];
  const selectedEntry = selected ? entryFor(draft, selected.id) : null;
  const observations = normalizeObservations(selectedEntry?.observations);
  const filledCount = students.filter((student) =>
    entryFor(draft, student.id).content.trim(),
  ).length;
  const reviewedCount = students.filter((student) => {
    const entry = entryFor(draft, student.id);
    return entry.content.trim() && entry.reviewed;
  }).length;
  const eligible = students.filter((student) => {
    const entry = entryFor(draft, student.id);
    return !entry.content.trim() && hasPersonalFacts(entry.observations);
  });
  const currentSignature = selected
    ? sourceSignature(draft, selected, selectedEntry?.generationSource === "outline" ? "" : styleReference)
    : "";
  const stale = Boolean(
    selectedEntry &&
      !selectedEntry.reviewed &&
      entryIsStale(selectedEntry, currentSignature),
  );
  const periodName =
    module === "one-to-one" ? "本次" : module === "evening" ? "本周" : "本月";
  const title =
    module === "one-to-one"
      ? "课后反馈"
      : module === "evening"
        ? "晚辅周反馈"
        : "班课月反馈";
  const activeBrief = draft.brief!;
  const isOneToOne = module === "one-to-one";

  function cacheDraft(session: FeedbackSession, base = baselineRef.current) {
    if (readonly) return false;
    const record: FeedbackDraftRecord = {
      session, baselineSnapshot: base, subjectText: subjectTextRef.current,
      selectedId: selectedIdRef.current, savedAt: new Date().toISOString(),
    };
    const result = writeFeedbackDraft(scope, record);
    setLocalError(result.error);
    if (result.ok) setLocalDrafts((prior) => [record, ...prior.filter((item) => item.session.id !== session.id)]);
    return result.ok;
  }

  function selectStudent(id: string) {
    selectedIdRef.current = id;
    setSelectedId(id);
    cacheDraft(draftRef.current);
  }

  function updateDraft(updater: (current: FeedbackSession) => FeedbackSession) {
    const next = updater(draftRef.current);
    draftRef.current = next;
    cacheDraft(next);
    setDraft(next);
  }
  function revision(id: string): Revision {
    return {
      epoch: epoch.current,
      context: contextVersion.current,
      entry: entryVersions.current.get(id) ?? 0,
    };
  }
  function cancelGeneration(
    message = "已取消生成；已完成的草稿和当前输入均已保留。",
  ) {
    generationId.current++;
    controller.current?.abort();
    controller.current = null;
    setProgress(null);
    setStatus({ text: message });
  }
  function changeEntry(
    id: string,
    updater: (entry: FeedbackEntry) => FeedbackEntry,
    userEdit = true,
  ) {
    if (userEdit)
      entryVersions.current.set(id, (entryVersions.current.get(id) ?? 0) + 1);
    updateDraft((current) => {
      const next = updater(entryFor(current, id));
      const exists = current.entries.some((entry) => entry.studentId === id);
      return {
        ...current,
        entries: exists
          ? current.entries.map((entry) =>
              entry.studentId === id ? next : entry,
            )
          : [...current.entries, next],
      };
    });
    if (userEdit) setStatus(null);
    setFailures((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }
  function changeObservation(
    key: Exclude<keyof StudentObservations, "subjects">,
    value: string,
  ) {
    if (!selected) return;
    changeEntry(selected.id, (entry) => ({
      ...entry,
      observations: {
        ...normalizeObservations(entry.observations),
        [key]: value,
      },
      reviewed: false,
    }));
  }
  function changeBrief(change: Partial<FeedbackBrief>, lessonAt?: string) {
    contextVersion.current++;
    if (controller.current)
      cancelGeneration(
        `${isOneToOne ? "课程信息" : "共用信息"}已修改，已停止当前生成。已有正文保留，请重新核对。`,
      );
    else setStatus(null);
    updateDraft((current) => ({
      ...current,
      lessonAt: lessonAt ?? current.lessonAt,
      brief: { ...current.brief!, ...change },
      entries: current.entries.map((entry) => ({ ...entry, reviewed: false })),
    }));
  }
  function loadSession(session?: FeedbackSession) {
    generationId.current++;
    controller.current?.abort();
    controller.current = null;
    epoch.current++;
    contextVersion.current = 0;
    entryVersions.current.clear();
    const local = session && readFeedbackDrafts(scope).drafts.find((item) => item.session.id === session.id);
    const remote = session && sessions.find((item) => item.id === session.id);
    const remoteBaseline = remote ? feedbackSnapshot(makeDraft(module, studentsRef.current, classId, studentId, remote)) : "";
    const alreadySaved = local && feedbackSnapshot(local.session) === remoteBaseline;
    const recover = local && (feedbackSnapshot(local.session) !== local.baselineSnapshot || alreadySaved);
    const next = makeDraft(
      module,
      studentsRef.current,
      classId,
      studentId,
      recover ? local.session : session,
    );
    draftRef.current = next;
    setDraft(next);
    baselineRef.current = recover ? alreadySaved ? remoteBaseline : local.baselineSnapshot : session ? feedbackSnapshot(next) : "";
    setBaseline(baselineRef.current);
    subjectTextRef.current = recover ? local.subjectText : next.brief!.subjects.join("、");
    setSubjectText(subjectTextRef.current);
    selectedIdRef.current = recover && studentsRef.current.some((student) => student.id === local.selectedId)
      ? local.selectedId : studentsRef.current.some((student) => student.id === selectedIdRef.current) ? selectedIdRef.current : studentsRef.current[0]?.id ?? "";
    setSelectedId(selectedIdRef.current);
    setRecoveryConflict(Boolean(recover && !alreadySaved && local.baselineSnapshot !== remoteBaseline));
    setAutoSaveError(false);
    loadedSignature.current = remote ? JSON.stringify(remote) : "";
    if (!session || recover) cacheDraft(next);
    setStatus(null);
    setProgress(null);
    setFailures(new Map());
    setProposal(null);
    setConfirmation(null);
  }
  function requestSession(session?: FeedbackSession) {
    if (session?.id === draft.id) return;
    if (progress || localError) {
      setConfirmation({
        title: "切换前处理当前反馈",
        message:
          localError ? "本机草稿未能保存，请先复制留存当前文字。继续切换会离开当前编辑区。" : "生成尚未完成，切换会停止生成。已输入的内容保留在本机草稿中。",
        label: "继续切换",
        action: () => loadSession(session),
      });
    } else loadSession(session);
  }
  useEffect(() => {
    dirtyCallback.current?.((dirty && Boolean(localError)) || styleDirty || Boolean(progress));
  }, [dirty, localError, styleDirty, progress]);
  useEffect(() => {
    if (styleRef.current === styleReference) return;
    styleRef.current = styleReference;
    contextVersion.current++;
    if (controller.current) {
      cancelGeneration("风格参考已更新，已停止当前生成。请使用新参考重新生成。已有正文保留。");
    }
  }, [styleReference]);
  useEffect(
    () => () => {
      epoch.current++;
      generationId.current++;
      controller.current?.abort();
      dirtyCallback.current?.(false);
    },
    [],
  );
  useEffect(() => {
    if (dirty || saving || progress || recoveryConflict) return;
    const latest = sessions.find((session) => session.id === draft.id);
    if (latest && JSON.stringify(latest) !== loadedSignature.current)
      loadSession(latest);
    else if (!latest && loadedSignature.current)
      loadSession(orderedSessions[0]);
  }, [sessions, orderedSessions, draft.id, dirty, saving, progress, recoveryConflict]);
  useEffect(() => {
    const changed = students.filter(
      (student) =>
        rosterSignature.current.has(student.id) &&
        rosterSignature.current.get(student.id) !==
          `${student.name}\0${student.grade}`,
    );
    rosterSignature.current = new Map(
      students.map((student) => [
        student.id,
        `${student.name}\0${student.grade}`,
      ]),
    );
    for (const student of changed)
      changeEntry(student.id, (entry) => ({ ...entry, reviewed: false }));
    if (!students.some((student) => student.id === selectedId)) {
      selectedIdRef.current = students[0]?.id ?? "";
      setSelectedId(selectedIdRef.current);
    }
  }, [students, selectedId]);

  function validateContext(): boolean {
    const current = draftRef.current;
    const brief = current.brief!;
    const contextErrors = feedbackInputErrors({ module, brief }, { lessonAt: current.lessonAt });
    if (contextErrors.length) {
      setStatus({ text: contextErrors.join(" "), error: true });
      return false;
    }
    for (const entry of current.entries) {
      const errors = feedbackInputErrors({
        module, brief, observations: normalizeObservations(entry.observations),
      });
      if (entry.content.length > 10000) errors.push("反馈正文不能超过 10000 字，请精简正文。");
      if (errors.length) {
        const student = studentsRef.current.find((item) => item.id === entry.studentId);
        setStatus({
          text: `${student ? `${student.name}：` : ""}${errors.join(" ")}`,
          error: true,
        });
        return false;
      }
    }
    return true;
  }
  function snapshotForSave(): FeedbackSession {
    return {
      ...draftRef.current,
      entries: studentsRef.current.map((student) =>
        entryFor(draftRef.current, student.id),
      ),
      updatedAt: new Date().toISOString(),
    };
  }
  async function save(automatic = false) {
    if (readonly || saveLock.current || recoveryConflict || autoSaveBlocked) return;
    if (!automatic && !validateContext()) return;
    const saved = snapshotForSave();
    if (!hasFeedbackContent(saved)) {
      if (!automatic) setStatus({
        text: "先填写一点课程内容、学生记录或反馈正文，再保存草稿。",
        error: true,
      });
      return;
    }
    const atEpoch = epoch.current;
    const submitted = feedbackSnapshot(saved);
    const submittedSubjectText = subjectTextRef.current;
    const submittedSelection = selectedIdRef.current;
    saveLock.current = true;
    setSaving(true);
    try {
      const ok = await onSaveRef.current(saved, automatic);
      if (ok) {
        // A slow save must not erase text typed after the request started,
        // including when the teacher has already switched to another lesson.
        const pending = readFeedbackDrafts(scope).drafts.find((item) => item.session.id === saved.id);
        if (pending && feedbackSnapshot(pending.session) === submitted &&
          pending.subjectText === submittedSubjectText && pending.selectedId === submittedSelection) {
          const removed = removeFeedbackDraft(scope, saved.id);
          if (!removed.ok) setLocalError(removed.error);
          else setLocalDrafts((prior) => prior.filter((item) => item.session.id !== saved.id));
        } else if (pending) {
          const acknowledged = { ...pending, baselineSnapshot: submitted };
          const result = writeFeedbackDraft(scope, acknowledged);
          if (!result.ok) setLocalError(result.error);
          else setLocalDrafts((prior) => prior.map((item) => item.session.id === saved.id ? acknowledged : item));
        }
      }
      if (draftRef.current.id !== saved.id) return;
      if (ok) {
        loadedSignature.current = JSON.stringify(saved);
        baselineRef.current = submitted;
        setBaseline(submitted);
        setAutoSaveError(false);
        const current = draftRef.current;
        const next = {
          ...current,
          entries: studentsRef.current.map((student) =>
            entryFor(current, student.id),
          ),
          updatedAt: saved.updatedAt,
        };
        draftRef.current = next;
        setDraft(next);
        if (feedbackSnapshot(next) !== submitted) cacheDraft(next, submitted);
        if (!automatic && atEpoch === epoch.current) setStatus({
          text:
            feedbackSnapshot(draftRef.current) === submitted
              ? "草稿已保存。可以随时回来补充、生成和核对。"
              : "本次提交已保存；保存期间的新修改仍待保存。",
        });
      } else {
        setAutoSaveError(true);
        if (!automatic) setStatus({
          text: "保存未完成，请按页面提示处理后重试。所有输入仍保留。",
          error: true,
        });
      }
    } catch (error) {
      if (atEpoch === epoch.current) {
        setAutoSaveError(true);
        if (!automatic) setStatus({
          text:
            error instanceof Error
              ? error.message
              : "保存失败，当前输入已保留。",
          error: true,
        });
      }
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  const inputErrors = feedbackInputErrors({ module, brief: activeBrief }, { lessonAt: draft.lessonAt });
  for (const entry of draft.entries) {
    inputErrors.push(...feedbackInputErrors({ module, brief: activeBrief, observations: entry.observations }));
    if (entry.content.length > 10000) inputErrors.push("反馈正文不能超过 10000 字，请精简正文。");
  }
  const canAutoSave = dirty && hasFeedbackContent(draft) && !inputErrors.length && !recoveryConflict && !autoSaveBlocked;
  useEffect(() => {
    if (readonly || saving || progress || !canAutoSave) return;
    const timer = setTimeout(() => void saveRef.current(true), autoSaveError ? 15000 : 1000);
    return () => clearTimeout(timer);
  }, [draft, readonly, saving, progress, canAutoSave, autoSaveError]);

  const saveStatus = localError ? localError
    : recoveryConflict || autoSaveBlocked ? "本机草稿已保留，数据库有更新，请先处理版本冲突。"
    : saving ? "正在自动保存到数据库…"
    : dirty ? autoSaveError ? "已保留本机草稿，数据库暂未保存，稍后自动重试。"
      : inputErrors.length ? `已保留本机草稿。${[...new Set(inputErrors)].join(" ")}`
        : hasFeedbackContent(draft) ? "已保留本机草稿，正在等待自动保存。" : "已保留本机草稿，可继续填写。"
      : sessions.some((session) => session.id === draft.id) ? "已保存到数据库。" : "填写后自动保存，也可以点击立即保存。";
  function acceptGenerated(
    student: Student,
    content: string,
    source: "ai" | "outline",
    signature: string,
  ) {
    changeEntry(student.id, (entry) => ({
      ...entry,
      content,
      reviewed: false,
      generationSource: source,
      generatedFrom: signature,
    }));
  }
  function organize(student: Student) {
    if (!validateContext()) return;
    const current = draftRef.current;
    const entry = entryFor(current, student.id);
    if (!hasObservations(entry.observations)) {
      setStatus({
        text: "请先写下学生的真实记录或课后任务，再整理草稿。",
        error: true,
      });
      return;
    }
    const content = outlineFeedback(
      module,
      current.brief!,
      normalizeObservations(entry.observations),
    );
    if (content.length > 10000) {
      setStatus({
        text: "原始记录合计超过 10000 字，请先精简记录再整理。",
        error: true,
      });
      return;
    }
    const signature = sourceSignature(current, student);
    if (entry.content.trim())
      setProposal({
        student,
        content,
        source: "outline",
        signature,
        revision: revision(student.id),
      });
    else {
      acceptGenerated(student, content, "outline", signature);
      setStatus({
        text: "已按原始记录整理草稿，没有调用 AI，也没有补充未记录的事实。请检查后再复制。",
      });
    }
  }
  async function runGeneration(targets: Student[], single = false) {
    if (readonly || controller.current || !validateContext()) return;
    if (styleDirty) {
      setStatus({ text: "请先保存或撤销风格参考的修改，再生成反馈。", error: true });
      return;
    }
    const generationStyle = styleRef.current;
    if (!targets.length) {
      setStatus({
        text: "先补充学生的实际表现、亮点、困难或分科情况；仅有建议与任务不足以生成反馈。",
        error: true,
      });
      return;
    }
    const job = ++generationId.current;
    const abortController = new AbortController();
    controller.current = abortController;
    const summary: Progress = {
      total: targets.length,
      completed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      name: "",
    };
    setProgress({ ...summary });
    setNeedsConfiguration(false);
    setStatus(null);
    for (const target of targets) {
      if (job !== generationId.current || abortController.signal.aborted)
        return;
      const student = studentsRef.current.find((item) => item.id === target.id);
      const current = draftRef.current;
      const entry = student ? entryFor(current, student.id) : null;
      if (
        !student ||
        !entry ||
        !hasPersonalFacts(entry.observations) ||
        (!single && entry.content.trim())
      ) {
        summary.skipped++;
        summary.completed++;
        setProgress({ ...summary });
        continue;
      }
      const started = revision(student.id);
      const signature = sourceSignature(current, student, generationStyle);
      summary.name = student.name;
      setProgress({ ...summary });
      try {
        const result = await generateFeedback(
          {
            module,
            brief: structuredClone(current.brief!),
            observations: normalizeObservations(entry.observations),
            grade: student.grade,
            styleReference: generationStyle,
          },
          abortController.signal,
        );
        if (job !== generationId.current || abortController.signal.aborted)
          return;
        if (
          typeof result.content !== "string" ||
          !result.content.trim() ||
          result.content.length > 10000
        )
          throw new Error("AI 返回内容为空或过长，请重试。");
        if (
          !studentsRef.current.some((item) => item.id === student.id) ||
          !canApplyGeneration(started, revision(student.id))
        ) {
          summary.skipped++;
          setFailures((prior) =>
            new Map(prior).set(
              student.id,
              "生成期间记录已修改，返回结果未覆盖当前内容。可按最新记录重新生成。",
            ),
          );
        } else if (entry.content.trim()) {
          setProposal({
            student,
            content: result.content.trim(),
            source: "ai",
            signature,
            revision: started,
          });
          summary.success++;
        } else {
          acceptGenerated(student, result.content.trim(), "ai", signature);
          summary.success++;
        }
      } catch (error) {
        if (job !== generationId.current || abortController.signal.aborted)
          return;
        summary.failed++;
        const message =
          error instanceof Error ? error.message : "生成失败，请稍后重试。";
        setFailures((prior) => new Map(prior).set(student.id, message));
        if (error instanceof ApiError && error.status === 503) {
          setNeedsConfiguration(true);
          summary.skipped += targets.length - summary.completed - 1;
          summary.completed = targets.length;
          setStatus({
            text: "尚未配置可用的 AI 服务。可以先保存记录或按原始记录整理草稿，再打开 AI 设置。",
            error: true,
          });
          break;
        }
      }
      summary.completed++;
      setProgress({ ...summary });
    }
    if (job === generationId.current) {
      controller.current = null;
      setProgress(null);
      setStatus(
        (previous) =>
          previous ?? {
            text: isOneToOne
              ? (summary.failed ? "本次生成未完成，请查看下方原因后重试。" : "反馈已生成，请核对后复制。")
              : `生成完成：${summary.success} 位成功，${summary.failed} 位失败，${summary.skipped} 位跳过。请逐一核对后复制。`,
            error: summary.failed > 0,
          },
      );
    }
  }
  function requestGenerate(student: Student) {
    const entry = entryFor(draftRef.current, student.id);
    if (!hasPersonalFacts(entry.observations)) {
      setStatus({
        text: "请先记录这位学生的实际表现、亮点、困难或分科情况。建议和任务可以补充，但不会被当成已发生的事实。",
        error: true,
      });
      return;
    }
    if (entry.content.trim()) {
      setConfirmation({
        title: "基于当前记录生成新候选？",
        message:
          "现有正文会保留。生成完成后可以比较，再决定是否替换；不会直接覆盖你已写的反馈。",
        label: "生成候选草稿",
        action: () => {
          setConfirmation(null);
          void runGeneration([student], true);
        },
      });
    } else void runGeneration([student], true);
  }
  async function copy(student?: Student) {
    if (!validateContext()) return;
    const current = snapshotForSave();
    current.entries = current.entries.filter(
      (entry) => entry.reviewed && entry.content.trim(),
    );
    const text = student
      ? formatStudentFeedback(current, student, className)
      : formatClassFeedback(current, studentsRef.current, className);
    if (!text) {
      setStatus({
        text: "请先核对反馈正文，再勾选「已核对事实与措辞」。",
        error: true,
      });
      return;
    }
    setCopying(true);
    try {
      await copyFeedbackText(text);
      setStatus({
        text: student
          ? `已复制 ${student.name} 的反馈，可以粘贴发给对应家长。`
          : `已复制 ${current.entries.length} 位已核对学生的反馈，其他草稿已跳过。`,
      });
    } catch (error) {
      setCopyFallback({
        text,
        reason:
          error instanceof Error ? error.message : "自动复制失败，请手动复制。",
      });
    } finally {
      setCopying(false);
    }
  }
  const proposalValid = proposal
    ? canApplyGeneration(proposal.revision, revision(proposal.student.id)) &&
      students.some((student) => student.id === proposal.student.id)
    : false;
  const subjectFields = [
    ...new Set([
      ...activeBrief.subjects,
      ...Object.entries(observations.subjects)
        .filter(([, value]) => value.trim())
        .map(([subject]) => subject),
    ]),
  ];

  return (
    <section className="fb-workspace" aria-label="反馈工作区">
      <div className="fb-heading">
        <div>
          <span className="fb-eyebrow">LESS WRITING · MORE TEACHING</span>
          <h2>{title}</h2>
          <p>
            {isOneToOne
              ? "记录这节课学了什么、掌握得怎样，以及建议和课后任务，生成后核对再复制。"
              : "共用内容写一次，个人情况记短句，生成后核对再复制。"}
          </p>
        </div>
        <div className="fb-heading-actions">
          {onConfigureAI && (
            <button
              type="button"
              className="button button-ghost"
              onClick={onConfigureAI}
            >
              <Settings2 size={16} />
              AI 设置
            </button>
          )}
          {!readonly && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => requestSession()}
            >
              <Plus size={16} />
              新建{periodName}反馈
            </button>
          )}
        </div>
      </div>
      <div className={`fb-status ${localError || recoveryConflict || autoSaveBlocked ? "fb-status-error" : ""}`} role="status" aria-live="polite">
        <Save size={16} /><span>{saveStatus}</span>
      </div>
      {initial.restored && <p className="fb-field-note">已恢复上次留在本机的反馈草稿，可以继续编辑。</p>}
      {recoveryConflict && <div className="fb-recovery-actions">
        <p>数据库中的这份反馈已变更。当前保留的是本机文字，不会自动覆盖数据库。</p>
        <button type="button" className="button button-secondary" onClick={() => {
          const previousId = draftRef.current.id;
          const now = new Date().toISOString();
          const next = { ...draftRef.current, id: newId(), createdAt: now, updatedAt: now };
          if (!cacheDraft(next, "")) return;
          const removed = removeFeedbackDraft(scope, previousId);
          if (removed.ok) setLocalDrafts((prior) => prior.filter((item) => item.session.id !== previousId));
          else setLocalError(removed.error);
          baselineRef.current = "";
          setBaseline("");
          loadedSignature.current = "";
          draftRef.current = next;
          setDraft(next);
          setRecoveryConflict(false);
        }}>保留这份文字，另存为新反馈</button>
        <button type="button" className="button button-ghost" onClick={() => setConfirmation({
          title: "采用数据库版本？", message: "这会放弃当前这份本机草稿，显示数据库已保存的内容。", label: "放弃本机草稿并读取",
          action: () => {
            const id = draftRef.current.id;
            const result = removeFeedbackDraft(scope, id);
            if (!result.ok) { setLocalError(result.error); return; }
            setLocalDrafts((prior) => prior.filter((item) => item.session.id !== id));
            loadSession(sessions.find((item) => item.id === id));
          },
        })}>采用数据库版本</button>
      </div>}
      {onSaveStyle && (
        <FeedbackStyleReference
          module={module}
          value={styleReference}
          onSave={onSaveStyle}
          onDirtyChange={setStyleDirty}
          disabled={readonly || Boolean(progress)}
        />
      )}
      <section className="fb-common">
        <div className="fb-section-title">
          <h3>
            <span>01</span>
            {module === "one-to-one" ? "本次课程信息" : "共用信息，只写一次"}
          </h3>
          <span className={`fb-draft-badge ${dirty ? "fb-unsaved" : ""}`}>
            {dirty
              ? "本机草稿"
              : sessions.some((session) => session.id === draft.id)
                ? "已保存草稿"
                : "新草稿"}
          </span>
        </div>
        <div className="fb-context-row">
          {module === "one-to-one" ? (
            <label className="field">
              上课时间
              <input
                type="datetime-local"
                value={draft.lessonAt}
                min="1900-01-01T00:00"
                max="2100-12-31T23:59"
                readOnly={readonly}
                onChange={(event) =>
                  changeBrief(
                    {
                      periodStart: event.target.value.slice(0, 10),
                      periodEnd: event.target.value.slice(0, 10),
                    },
                    event.target.value,
                  )
                }
              />
            </label>
          ) : (
            <div className="fb-date-range">
              <label className="field">
                周期开始
                <input
                  aria-label="周期开始"
                  type="date"
                  value={activeBrief.periodStart}
                  min="1900-01-01"
                  max="2100-12-31"
                  readOnly={readonly}
                  onChange={(event) =>
                    changeBrief(
                      { periodStart: event.target.value },
                      `${event.target.value}T00:00`,
                    )
                  }
                />
              </label>
              <span>—</span>
              <label className="field">
                周期结束
                <input
                  aria-label="周期结束"
                  type="date"
                  value={activeBrief.periodEnd}
                  min="1900-01-01"
                  max="2100-12-31"
                  readOnly={readonly}
                  onChange={(event) =>
                    changeBrief({ periodEnd: event.target.value })
                  }
                />
              </label>
            </div>
          )}
          <label className="field">
            科目 <small>用顿号或逗号分隔，可修改</small>
            <input
              value={subjectText}
              maxLength={1000}
              readOnly={readonly}
              placeholder="例如：数学、物理"
              onChange={(event) => {
                subjectTextRef.current = event.target.value;
                setSubjectText(event.target.value);
                changeBrief({
                  subjects: [
                    ...new Set(
                      event.target.value
                        .split(/[,，、\n]/)
                        .map((value) => value.trim())
                        .filter(Boolean),
                    ),
                  ],
                });
              }}
              onBlur={() => {
                subjectTextRef.current = activeBrief.subjects.join("、");
                setSubjectText(subjectTextRef.current);
                cacheDraft(draftRef.current);
              }}
            />
          </label>
          <label className="field fb-length">
            反馈篇幅
            <select
              value={activeBrief.length}
              disabled={readonly}
              onChange={(event) =>
                changeBrief({
                  length: event.target.value as FeedbackBrief["length"],
                })
              }
            >
              <option value="brief">简短，抓住重点</option>
              <option value="standard">适中，说明情况</option>
            </select>
          </label>
        </div>
        <div className={`fb-common-fields ${isOneToOne ? "fb-lesson-fields" : ""}`}>
          <label className="field">
            {periodName}教学 / 学习内容 <small>选填</small>
            <textarea
              rows={2}
              value={activeBrief.teachingContent}
              maxLength={5000}
              readOnly={readonly}
              placeholder={
                module === "evening"
                  ? "这一周主要辅导了哪些内容？如：分式运算、力的示意图。"
                  : module === "course"
                    ? "这个月全班学了哪些章节、完成了哪些学习任务？"
                    : "今天讲了什么？如：一元二次方程的解法。"
              }
              onChange={(event) =>
                changeBrief({ teachingContent: event.target.value })
              }
            />
          </label>
          {!isOneToOne && <label className="field">
            {module === "course" ? "全班安排 / 共性提醒" : "共同课后任务"}{" "}
            <small>选填</small>
            <textarea
              rows={2}
              value={activeBrief.commonTasks}
              maxLength={5000}
              readOnly={readonly}
              placeholder={
                module === "course"
                  ? "有需要统一告知家长的安排再填写。"
                  : "所有学生相同的安排只写一次；没有就留空。"
              }
              onChange={(event) =>
                changeBrief({ commonTasks: event.target.value })
              }
            />
          </label>}
        </div>
        <details className="fb-optional">
          <summary>
            反馈表达重点 <span>选填，用来告诉 AI 这次重点说明什么</span>
          </summary>
          <label className="field">
            <span className="sr-only">反馈表达重点</span>
            <textarea
              rows={2}
              value={activeBrief.focus}
              maxLength={5000}
              readOnly={readonly}
              placeholder="例如：重点说明计算习惯，不要堆砌表扬；建议表达具体一些。"
              onChange={(event) => changeBrief({ focus: event.target.value })}
            />
          </label>
        </details>
      </section>
      {status && (
        <div
          className={`fb-status ${status.error ? "fb-status-error" : ""}`}
          role={status.error ? "alert" : "status"}
        >
          {!status.error && <Check size={16} />}
          <span>{status.text}</span>
          {needsConfiguration && onConfigureAI && (
            <button
              type="button"
              className="button button-secondary button-sm"
              onClick={onConfigureAI}
            >
              配置 AI
            </button>
          )}
        </div>
      )}
      <div className="fb-work-heading">
        <div>
          <h3>
            <span>02</span>{isOneToOne ? "本节课表现与课后安排" : "记录个人情况，核对家长反馈"}
          </h3>
          <p>
            {isOneToOne
              ? "填写简短观察，编辑并核对反馈正文。"
              : `${filledCount} 人已有正文 · ${reviewedCount} 人已核对`}
            {module === "evening"
              ? " · 初二默认数物，初三默认数物化，科目可在上方调整"
              : ""}
          </p>
        </div>
        {module !== "one-to-one" && !readonly && (
          <button
            type="button"
            className="button button-secondary"
            disabled={Boolean(progress) || styleDirty || !eligible.length}
            onClick={() => void runGeneration(eligible)}
          >
            <Sparkles size={16} />
            生成未完成反馈{eligible.length ? `（${eligible.length}）` : ""}
          </button>
        )}
      </div>
      {progress && (
        <div className="fb-generation-progress" role="status">
          <LoaderCircle size={17} className="fb-spin" />
          <span>
            {isOneToOne
              ? "正在生成本节课反馈…"
              : `正在生成 ${progress.name || "反馈"} · ${progress.completed} / ${progress.total}，失败 ${progress.failed} 位`}
          </span>
          <button
            type="button"
            className="button button-ghost button-sm"
            onClick={() => cancelGeneration()}
          >
            <Square size={13} />
            停止生成
          </button>
        </div>
      )}
      {!students.length ? (
        <div className="fb-empty">
          <FileText size={30} />
          <h3>{isOneToOne ? "请先添加一对一学生" : "先记录共用内容，或添加班级学生"}</h3>
          <p>{isOneToOne ? "进入学生页面，即可记录这节课并生成反馈。" : "学生加入后，就可以逐一补充真实情况并生成反馈。"}</p>
        </div>
      ) : (
        <div
          className={`fb-composer ${module === "one-to-one" ? "fb-one-student" : ""}`}
        >
          {module !== "one-to-one" && (
            <nav className="fb-roster" aria-label="选择反馈学生">
              <div className="fb-roster-heading">
                学生名单 <span>{students.length} 人</span>
              </div>
              {students.map((student) => {
                const entry = entryFor(draft, student.id);
                const state = failures.has(student.id)
                  ? "生成待重试"
                  : entry.content.trim()
                    ? entry.reviewed
                      ? "已核对"
                      : "待核对"
                    : hasObservations(entry.observations)
                      ? "已记录"
                      : "待记录";
                return (
                  <button
                    type="button"
                    key={student.id}
                    className={`fb-roster-item ${student.id === selected?.id ? "fb-roster-active" : ""}`}
                    aria-current={
                      student.id === selected?.id ? "true" : undefined
                    }
                    onClick={() => selectStudent(student.id)}
                  >
                    <span>
                      <strong>{student.name}</strong>
                      <small>{student.grade || "未设置年级"}</small>
                    </span>
                    <span
                      className={`fb-roster-state ${entry.reviewed ? "fb-reviewed" : ""}`}
                    >
                      {state}
                    </span>
                  </button>
                );
              })}
            </nav>
          )}
          {selected && selectedEntry && (
            <>
              <section className="fb-facts">
                <div className="fb-panel-title">
                  <div>
                    <h3>
                      {selected.name} <span>{isOneToOne ? "本节课记录" : "个人记录"}</span>
                    </h3>
                    <p>只写你实际了解的情况，不必组织成完整段落。</p>
                  </div>
                </div>
                <label className="field fb-observation">
                  {isOneToOne ? "课堂状态与掌握情况" : "学生情况"}
                  <small>只需在这里记几条事实，亮点、困难和建议可以写在一起，不必再逐项填写。</small>
                  <textarea
                    rows={4}
                    value={observations.performance}
                    maxLength={2000}
                    readOnly={readonly}
                    placeholder="如：能独立列出方程，移项时偶尔漏变号；遇到难题愿意尝试。短句即可。"
                    onChange={(event) =>
                      changeObservation("performance", event.target.value)
                    }
                  />
                </label>
                <details
                  className="fb-optional"
                  key={`${draft.id}-${selected.id}-details`}
                  open={Boolean(observations.strengths || observations.difficulties || observations.plan)}
                >
                  <summary>补充细节（选填）</summary>
                  {OBSERVATION_FIELDS.filter((item) => item.key !== "performance").map((item) => (
                    <label className="field fb-observation" key={item.key}>
                      {item.label}
                      <textarea
                        rows={1}
                        value={observations[item.key]}
                        maxLength={2000}
                        readOnly={readonly}
                        placeholder={item.placeholder}
                        onChange={(event) =>
                          changeObservation(item.key, event.target.value)
                        }
                      />
                    </label>
                  ))}
                </details>
                {module === "evening" && subjectFields.length > 0 && (
                  <div className="fb-subject-notes">
                    <h4>
                      分科情况 <span>有观察再写，空白科目不编写评价</span>
                    </h4>
                    {subjectFields.map((subject) => (
                      <label className="field" key={subject}>
                        {subject}
                        <textarea
                          rows={1}
                          value={
                            Object.hasOwn(observations.subjects, subject)
                              ? observations.subjects[subject]
                              : ""
                          }
                          maxLength={2000}
                          readOnly={readonly}
                          placeholder={`记录${subject}的具体学习情况`}
                          onChange={(event) => {
                            const value = event.target.value;
                            changeEntry(selected.id, (entry) => {
                              const notes = normalizeObservations(
                                entry.observations,
                              );
                              const nextSubjects = {
                                ...notes.subjects,
                                [subject]: value,
                              };
                              if (!value) delete nextSubjects[subject];
                              return {
                                ...entry,
                                observations: {
                                  ...notes,
                                  subjects: nextSubjects,
                                },
                                reviewed: false,
                              };
                            });
                          }}
                        />
                      </label>
                    ))}
                  </div>
                )}
                {isOneToOne ? (
                  <label className="field fb-observation">
                    课后任务 <small>选填，填写本节课实际布置的作业或复习安排</small>
                    <textarea
                      rows={2}
                      value={observations.tasks}
                      maxLength={8000}
                      readOnly={readonly}
                      placeholder="如：完成讲义第 3 页第 1—4 题，订正今天的两道错题。未布置可留空。"
                      onChange={(event) => changeObservation("tasks", event.target.value)}
                    />
                  </label>
                ) : <details
                  className="fb-optional"
                  open={Boolean(observations.tasks)}
                >
                  <summary>
                    个人任务 <span>仅这位学生的安排，选填</span>
                  </summary>
                  <label className="field">
                    <span className="sr-only">个人任务</span>
                    <textarea
                      rows={2}
                      value={observations.tasks}
                      maxLength={8000}
                      readOnly={readonly}
                      placeholder="如需单独安排练习，在这里补充。"
                      onChange={(event) =>
                        changeObservation("tasks", event.target.value)
                      }
                    />
                  </label>
                </details>}
                {!hasPersonalFacts(observations) && (
                  <p className="fb-field-note">
                    填写一条实际表现、亮点、困难或分科情况后，即可生成。建议和任务不会被当作已发生的事实。
                  </p>
                )}
                {!activeBrief.teachingContent.trim() &&
                  hasPersonalFacts(observations) && (
                    <p className="fb-field-note">
                      {isOneToOne
                        ? "未填写本节课教学内容，生成时将只依据已记录的课堂情况。"
                        : "未填写共用教学内容，生成时将只依据已记录的个人情况。"}
                    </p>
                  )}
                {!readonly && (
                  <div className="fb-generate-actions">
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={
                        Boolean(progress) || styleDirty || !hasPersonalFacts(observations)
                      }
                      onClick={() => requestGenerate(selected)}
                    >
                      <Sparkles size={16} />
                      {selectedEntry.content.trim()
                        ? "重新生成候选"
                        : "AI 生成反馈"}
                    </button>
                    <button
                      type="button"
                      className="button button-ghost button-sm"
                      disabled={
                        Boolean(progress) || !hasObservations(observations)
                      }
                      onClick={() => organize(selected)}
                    >
                      <WandSparkles size={15} />
                      按原始记录整理草稿
                    </button>
                    <small>整理草稿不调用 AI，不添加未记录的事实。</small>
                  </div>
                )}
                {styleDirty && <p className="fb-field-note">风格参考有未保存修改，请先保存或撤销，再使用 AI 生成。</p>}
                {failures.has(selected.id) && (
                  <p className="fb-inline-error" role="alert">
                    {failures.get(selected.id)}
                  </p>
                )}
              </section>
              <section className="fb-output">
                <div className="fb-panel-title">
                  <div>
                    <h3>发给家长的反馈</h3>
                    <p>可以直接手写，也可以编辑生成后的正文。</p>
                  </div>
                  <span className="fb-source-badge">
                    {selectedEntry.generationSource === "ai"
                      ? "AI 草稿"
                      : selectedEntry.generationSource === "outline"
                        ? "原始记录整理"
                        : "自由编辑"}
                  </span>
                </div>
                {stale && (
                  <div className="fb-stale" role="status">
                    生成依据已更新，正文仍保留旧内容。请重新生成，或修改并再次核对。
                  </div>
                )}
                <label
                  className="field fb-output-field"
                  htmlFor={`${fieldId}-content`}
                >
                  <span className="sr-only">{selected.name}的家长反馈正文</span>
                  <textarea
                    id={`${fieldId}-content`}
                    rows={17}
                    maxLength={10000}
                    readOnly={readonly}
                    value={selectedEntry.content}
                    placeholder="家长反馈会显示在这里。你也可以直接手写，已有内容不会被生成结果直接覆盖。"
                    onChange={(event) => {
                      const content = event.target.value;
                      changeEntry(selected.id, (entry) => ({
                        ...entry,
                        content,
                        reviewed: false,
                        generationSource: "manual",
                      }));
                    }}
                  />
                </label>
                <div className="fb-output-count">
                  {selectedEntry.content.length} / 10000 字
                </div>
                <label className="fb-review-check">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedEntry.reviewed)}
                    disabled={readonly || !selectedEntry.content.trim()}
                    onChange={(event) => {
                      const reviewed = event.target.checked;
                      changeEntry(selected.id, (entry) => ({
                        ...entry,
                        reviewed,
                      }));
                    }}
                  />
                  <span>
                    已核对事实与措辞，可以发给家长
                    <small>修改记录或正文后，需要重新核对。</small>
                  </span>
                </label>
                <button
                  type="button"
                  className="button button-secondary fb-copy-button"
                  disabled={
                    !selectedEntry.reviewed ||
                    !selectedEntry.content.trim() ||
                    copying
                  }
                  onClick={() => void copy(selected)}
                >
                  <Copy size={16} />
                  复制 {selected.name} 的反馈
                </button>
                <p className="fb-field-note">
                  只复制到剪贴板，由你决定何时、发给哪位家长。
                </p>
              </section>
            </>
          )}
        </div>
      )}
      <div className="fb-savebar">
        <p>
          <CheckCheck size={16} />
          {isOneToOne
            ? (reviewedCount ? "本次反馈已核对" : "本次反馈待核对")
            : `已核对 ${reviewedCount} / ${students.length} 人`}
          <span>{saving ? "保存中" : dirty ? "本机草稿待同步" : "草稿可随时继续补充"}</span>
        </p>
        <div>
          {module !== "one-to-one" && (
            <button
              type="button"
              className="button button-secondary"
              disabled={!reviewedCount || copying}
              onClick={() => void copy()}
            >
              <Copy size={16} />
              复制已核对反馈（{reviewedCount}）
            </button>
          )}
          {!readonly && (
            <button
              type="button"
              className="button button-primary"
              disabled={
                saving ||
                recoveryConflict || autoSaveBlocked ||
                !hasFeedbackContent(draft) ||
                (!dirty && sessions.some((session) => session.id === draft.id))
              }
              onClick={() => void save()}
            >
              {saving ? (
                <LoaderCircle size={16} className="fb-spin" />
              ) : (
                <Save size={16} />
              )}
              {saving ? "正在保存…" : "立即保存"}
            </button>
          )}
        </div>
      </div>
      {localDrafts.some((item) => feedbackSnapshot(item.session) !== item.baselineSnapshot) && <details className="fb-history" open>
        <summary><span><Save size={17} />本机未同步草稿</span></summary>
        <div className="fb-history-list">
          {localDrafts.filter((item) => feedbackSnapshot(item.session) !== item.baselineSnapshot).map((item) => <button
            type="button" key={item.session.id} className={`fb-history-item ${item.session.id === draft.id ? "fb-history-active" : ""}`}
            onClick={() => requestSession(item.session)}>
            <strong>{formatFeedbackPeriod(item.session) || "日期待填写"}</strong><span>本机已保留 · 点击继续填写</span>
          </button>)}
        </div>
      </details>}
      <details className="fb-history">
        <summary>
          <span>
            <Clock3 size={17} />
            历史反馈 <strong>{orderedSessions.length} 次 · 最近编辑优先</strong>
          </span>
          <ChevronRight size={16} />
        </summary>
        {orderedSessions.length ? (
          <>
            <div className="fb-history-list">
              {orderedSessions.slice(0, historyLimit).map((session) => (
                <button
                  type="button"
                  key={session.id}
                  className={`fb-history-item ${session.id === draft.id ? "fb-history-active" : ""}`}
                  onClick={() => requestSession(session)}
                >
                  <strong>{formatFeedbackPeriod(session)}</strong>
                  <span>
                    {isOneToOne ? (
                      session.entries[0]?.content.trim()
                        ? (session.entries[0].reviewed ? "已核对" : "待核对")
                        : "已记录，待完成正文"
                    ) : <>{
                      session.entries.filter((entry) => entry.content.trim())
                        .length
                    }{" "}
                    人有正文 ·{" "}
                    {
                      session.entries.filter(
                        (entry) => entry.reviewed && entry.content.trim(),
                      ).length
                    }{" "}
                    人已核对</>}
                  </span>
                </button>
              ))}
            </div>
            {historyLimit < orderedSessions.length && (
              <button
                type="button"
                className="button button-ghost button-sm fb-more"
                onClick={() => setHistoryLimit((limit) => limit + 20)}
              >
                查看更多历史
              </button>
            )}
          </>
        ) : (
          <p className="fb-history-empty">
            保存后，可以在这里回到之前的课程或周期继续补写。
          </p>
        )}
      </details>
      {confirmation && (
        <Modal title={confirmation.title} onClose={() => setConfirmation(null)}>
          <p className="confirm-message">{confirmation.message}</p>
          <div className="form-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setConfirmation(null)}
            >
              返回编辑
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={confirmation.action}
            >
              {confirmation.label}
            </button>
          </div>
        </Modal>
      )}
      {proposal && (
        <Modal
          title={`${proposal.student.name} · 比较新候选草稿`}
          subtitle={
            proposal.source === "ai"
              ? "现有正文尚未改变。接受替换后仍需人工核对。"
              : "这份草稿只整理原始记录，没有调用 AI。"
          }
          wide
          onClose={() => setProposal(null)}
        >
          <div className="fb-proposal-columns">
            <div>
              <h3>现有正文</h3>
              <pre>
                {entryFor(draft, proposal.student.id).content || "（当前为空）"}
              </pre>
            </div>
            <div>
              <h3>新候选草稿</h3>
              <pre>{proposal.content}</pre>
            </div>
          </div>
          {!proposalValid && (
            <p className="fb-inline-error">
              生成后原始输入又有变化，本候选不能覆盖当前内容。请关闭后按最新记录重新生成。
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setProposal(null)}
            >
              保留原文
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={!proposalValid}
              onClick={() => {
                if (
                  !canApplyGeneration(
                    proposal.revision,
                    revision(proposal.student.id),
                  )
                )
                  return;
                acceptGenerated(
                  proposal.student,
                  proposal.content,
                  proposal.source,
                  proposal.signature,
                );
                setProposal(null);
                setStatus({
                  text: "已采用候选草稿，请核对事实与措辞后再复制。",
                });
              }}
            >
              接受并替换正文
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
            选中文字后按 Ctrl+C（Mac 按 ⌘C），或使用设备的复制菜单。
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
