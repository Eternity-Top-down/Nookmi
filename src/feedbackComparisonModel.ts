import { normalizeObservations } from "./feedbackModel";
import type {
  FeedbackAIDraft,
  FeedbackEntry,
  FeedbackInputSnapshot,
  FeedbackSession,
  Student,
} from "./types";

/** Capture the records actually used for this student's generation, before awaiting AI. */
export function captureFeedbackInput(session: FeedbackSession, student: Student): FeedbackInputSnapshot {
  const entry = session.entries.find((item) => item.studentId === student.id);
  if (!session.brief || !entry || student.module !== session.module)
    throw new Error("无法匹配本次反馈的课程和学生记录。");
  return structuredClone({
    module: session.module,
    grade: student.grade,
    lessonAt: session.lessonAt,
    brief: session.brief,
    observations: normalizeObservations(entry.observations),
  });
}

/** Ordinary edits continue the confirmed text's lineage while keeping its last archive. */
export function resumeFeedbackEditing(entry: FeedbackEntry): FeedbackEntry {
  if (!entry.reviewed || !entry.comparison || entry.aiDraft) return entry;
  assertSourceOwner(entry, entry.comparison.source);
  return { ...entry, aiDraft: structuredClone(entry.comparison.source) };
}

function assertSourceOwner(entry: FeedbackEntry, source: FeedbackAIDraft) {
  if (source.studentId !== entry.studentId)
    throw new Error("AI 原稿与当前学生不匹配，请重新生成。");
}

/** Only a candidate placed in the editor gets retained; proposals never call this helper. */
export function adoptGeneratedFeedback(
  entry: FeedbackEntry,
  content: string,
  source: "ai" | "outline",
  signature: string,
  aiDraft?: FeedbackAIDraft,
): FeedbackEntry {
  if (source === "ai") {
    if (!aiDraft || aiDraft.content !== content)
      throw new Error("AI 原稿与当前生成内容不匹配，请重新生成。");
    assertSourceOwner(entry, aiDraft);
  }
  const next: FeedbackEntry = {
    ...entry,
    content,
    reviewed: false,
    generationSource: source,
    generatedFrom: signature,
  };
  if (source === "ai") next.aiDraft = structuredClone(aiDraft!);
  else delete next.aiDraft;
  return next;
}

/** Confirmation replaces one archive; it never appends to a history of AI attempts. */
export function setFeedbackReviewed(
  entry: FeedbackEntry,
  reviewed: boolean,
  input: FeedbackInputSnapshot,
  confirmedAt = new Date().toISOString(),
): FeedbackEntry {
  const next: FeedbackEntry = { ...entry, reviewed };
  if (!reviewed) {
    // A later unreviewed replacement must not inherit a different old AI response.
    if (entry.reviewed && entry.comparison && !entry.aiDraft) {
      assertSourceOwner(entry, entry.comparison.source);
      next.aiDraft = structuredClone(entry.comparison.source);
    }
    delete next.comparison;
    return next;
  }
  if (!entry.content.trim()) throw new Error("请先完成反馈正文，再确认采用。");
  if (entry.aiDraft) {
    assertSourceOwner(entry, entry.aiDraft);
    if (entry.aiDraft.input.module !== input.module)
      throw new Error("AI 原稿与当前反馈模块不匹配，请重新生成。");
    next.comparison = {
      source: structuredClone(entry.aiDraft),
      finalContent: entry.content,
      finalInput: structuredClone(input),
      confirmedAt,
    };
    delete next.aiDraft;
  } else if (!entry.reviewed) {
    // Handwritten/outline/legacy feedback can be reviewed, but has no invented AI source.
    delete next.comparison;
  }
  return next;
}

/** Conflict recovery creates a draft, never a second confirmed copy of an old archive. */
export function cloneFeedbackAsNewSession(
  session: FeedbackSession,
  newId: string,
  now = new Date().toISOString(),
): FeedbackSession {
  if (!newId || newId === session.id) throw new Error("新反馈需要使用独立的编号。");
  const copied = structuredClone(session);
  return {
    ...copied,
    id: newId,
    createdAt: now,
    updatedAt: now,
    entries: copied.entries.map((entry) => {
      const next = { ...resumeFeedbackEditing(entry), reviewed: false };
      delete next.comparison;
      if (next.aiDraft) {
        if (next.aiDraft.sessionId !== session.id)
          throw new Error("AI 原稿与当前反馈不匹配，无法另存。");
        // The generation ID still identifies the same original response; its owner changes.
        next.aiDraft = { ...next.aiDraft, sessionId: newId };
      }
      return next;
    }),
  };
}
