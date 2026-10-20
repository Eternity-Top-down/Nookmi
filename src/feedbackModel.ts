import type {
  FeedbackBrief,
  FeedbackEntry,
  FeedbackSession,
  ModuleId,
  StudentObservations,
} from "./types";

export function emptyObservations(): StudentObservations {
  return {
    performance: "",
    strengths: "",
    difficulties: "",
    plan: "",
    tasks: "",
    subjects: {},
  };
}

export function normalizeObservations(
  value?: StudentObservations,
): StudentObservations {
  return value
    ? { ...value, subjects: { ...value.subjects } }
    : emptyObservations();
}

/** Combine legacy one-on-one task fields without dropping either set of notes. */
export function mergeLessonTasks(commonTasks: string, tasks: string): string {
  const common = commonTasks.trim();
  const individual = tasks.trim();
  if (!common) return individual;
  if (!individual || common === individual) return common;
  return `${common}\n${individual}`;
}

export function normalizeOneToOneTasks(
  session: FeedbackSession,
): FeedbackSession {
  if (
    session.module !== "one-to-one" ||
    !session.brief ||
    session.entries.length !== 1
  ) {
    return session;
  }
  const entry = session.entries[0];
  const priorTasks = entry.observations?.tasks ?? "";
  const tasks = mergeLessonTasks(session.brief.commonTasks, priorTasks);
  if (session.brief.commonTasks === "" && tasks === priorTasks) return session;
  return {
    ...session,
    brief: { ...session.brief, commonTasks: "" },
    entries: [
      {
        ...entry,
        observations: { ...normalizeObservations(entry.observations), tasks },
      },
    ],
  };
}

export function defaultSubjects(module: ModuleId, grades: string[]): string[] {
  if (module !== "evening") return ["数学"];
  if (grades.some((grade) => /初三|九年级|9年级/.test(grade)))
    return ["数学", "物理", "化学"];
  if (grades.some((grade) => /初二|八年级|8年级/.test(grade)))
    return ["数学", "物理"];
  return ["数学"];
}

function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function defaultBrief(
  module: ModuleId,
  grades: string[],
  date = new Date(),
): FeedbackBrief {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(start);
  if (module === "evening") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 4);
  } else if (module === "course") {
    start.setDate(1);
    end.setMonth(start.getMonth() + 1, 0);
  }
  return {
    periodStart: localDay(start),
    periodEnd: localDay(end),
    subjects: defaultSubjects(module, grades),
    teachingContent: "",
    commonTasks: "",
    focus: "",
    length: "standard",
  };
}

export function hasObservations(observations?: StudentObservations): boolean {
  if (!observations) return false;
  return [
    observations.performance,
    observations.strengths,
    observations.difficulties,
    observations.plan,
    observations.tasks,
    ...Object.values(observations.subjects),
  ].some((value) => value.trim());
}

export function hasPersonalFacts(observations?: StudentObservations): boolean {
  if (!observations) return false;
  return [
    observations.performance,
    observations.strengths,
    observations.difficulties,
    ...Object.values(observations.subjects),
  ].some((value) => value.trim());
}

export function hasBriefContent(brief?: FeedbackBrief): boolean {
  return Boolean(
    brief &&
      [brief.teachingContent, brief.commonTasks, brief.focus].some((value) =>
        value.trim(),
      ),
  );
}

export function hasFeedbackContent(session: FeedbackSession): boolean {
  return (
    hasBriefContent(session.brief) ||
    session.entries.some(
      (entry) => entry.content.trim() || hasObservations(entry.observations),
    )
  );
}

/** Stable and compact provenance marker; no source notes are duplicated into backups. */
export function generationSignature(
  module: ModuleId,
  brief: FeedbackBrief,
  observations: StudentObservations,
  grade: string,
  lessonAt = "",
  styleReference = "",
): string {
  const inputs: unknown[] = [
    module,
    grade,
    lessonAt,
    brief.periodStart,
    brief.periodEnd,
    brief.subjects,
    brief.teachingContent,
    brief.commonTasks,
    brief.focus,
    brief.length,
    observations.performance,
    observations.strengths,
    observations.difficulties,
    observations.plan,
    observations.tasks,
    Object.entries(observations.subjects).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ),
  ];
  // Keep signatures from pre-style versions valid when no reference is provided.
  if (styleReference) inputs.push(styleReference);
  const source = JSON.stringify(inputs);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < source.length; index++) {
    first = Math.imul(first ^ source.charCodeAt(index), 0x01000193);
    second = Math.imul(second ^ source.charCodeAt(index), 0x85ebca6b);
  }
  return `fnv-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

export function entryIsStale(entry: FeedbackEntry, signature: string): boolean {
  return Boolean(
    entry.content.trim() &&
      entry.generatedFrom &&
      entry.generatedFrom !== signature,
  );
}

/** Format only facts actually entered by the teacher. This does not call or imitate AI. */
export function outlineFeedback(
  module: ModuleId,
  brief: FeedbackBrief,
  observations: StudentObservations,
): string {
  if (
    !hasObservations(observations) &&
    !(module === "one-to-one" && brief.commonTasks.trim())
  ) return "";
  const lines: string[] = [];
  const section = (label: string, content: string) => {
    if (content.trim()) lines.push(`${label}\n${content.trim()}`);
  };
  section(
    module === "evening"
      ? "本周学习内容"
      : module === "course"
        ? "本月学习内容"
        : "本次学习内容",
    brief.teachingContent,
  );
  section("学习情况", observations.performance);
  for (const [subject, content] of Object.entries(observations.subjects))
    section(`${subject}情况`, content);
  section("做得好的地方", observations.strengths);
  section("需要关注的地方", observations.difficulties);
  section("下一步安排", observations.plan);
  if (module === "one-to-one") {
    section("课后任务", mergeLessonTasks(brief.commonTasks, observations.tasks));
  } else {
    section("共同任务", brief.commonTasks);
    section("个人任务", observations.tasks);
  }
  return lines.join("\n\n");
}

/** Ignore metadata updated by persistence; preserve every user-authored field. */
export function feedbackSnapshot(session: FeedbackSession): string {
  return JSON.stringify({
    lessonAt: session.lessonAt,
    brief: session.brief,
    entries: session.entries,
  });
}

/** Reopen the teacher's latest work, even when a monthly period starts earlier. */
export function sortFeedbackByRecentEdit(
  sessions: readonly FeedbackSession[],
): FeedbackSession[] {
  return [...sessions].sort(
    (a, b) =>
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
      b.lessonAt.localeCompare(a.lessonAt),
  );
}

export function canApplyGeneration(
  started: { epoch: number; context: number; entry: number },
  current: { epoch: number; context: number; entry: number },
): boolean {
  return (
    started.epoch === current.epoch &&
    started.context === current.context &&
    started.entry === current.entry
  );
}
