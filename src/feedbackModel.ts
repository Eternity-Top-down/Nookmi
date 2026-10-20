import type {
  FeedbackBrief,
  FeedbackEntry,
  FeedbackSession,
  ModuleId,
  StudentObservations,
} from "./types";
import { isValidLessonAt } from "./feedback";

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

/** Share the API's editable-field limits without requiring optional course notes. */
export function feedbackInputErrors(
  input: {
    module: ModuleId;
    brief: FeedbackBrief;
    observations?: StudentObservations;
    grade?: string;
    styleReference?: string;
  },
  options: { lessonAt?: string; requirePersonalFacts?: boolean } = {},
): string[] {
  const { module, brief, observations } = input;
  const errors: string[] = [];
  const startValid = isValidLessonAt(`${brief.periodStart}T00:00`);
  const endValid = isValidLessonAt(`${brief.periodEnd}T00:00`);
  if (module === "one-to-one") {
    if (!startValid || !endValid ||
      (options.lessonAt !== undefined && !isValidLessonAt(options.lessonAt))) {
      errors.push("请填写有效的上课时间（1900—2100 年），日期和时分都要完整。");
    } else if (brief.periodEnd < brief.periodStart) {
      errors.push("上课时间对应的日期范围不正确，请重新选择上课时间。");
    }
  } else {
    if (!startValid || (options.lessonAt !== undefined && !isValidLessonAt(options.lessonAt)))
      errors.push("请填写有效的周期开始日期（1900—2100 年）。");
    if (!endValid) errors.push("请填写有效的周期结束日期（1900—2100 年）。");
    if (startValid && endValid && brief.periodEnd < brief.periodStart)
      errors.push("周期结束日期不能早于周期开始日期，请调整这两个日期。");
  }
  const checkSubjects = (names: string[], label: string) => {
    if (names.length > 10) errors.push(`${label}最多填写 10 个。`);
    if (names.some((name) => !name.trim() || name.length > 50))
      errors.push(`${label}名称不能为空，每个名称最多 50 字。`);
    if (new Set(names.map((name) => name.trim())).size !== names.length)
      errors.push(`${label}名称不能重复，请合并重复的科目。`);
  };
  checkSubjects(brief.subjects, "科目");
  const fields: [string, string, number][] = [
    ["教学 / 学习内容", brief.teachingContent, 5000],
    [module === "course" ? "全班安排 / 共性提醒" : module === "one-to-one" ? "课后任务" : "共同课后任务", brief.commonTasks, 5000],
    ["反馈表达重点", brief.focus, 5000],
  ];
  if (observations) {
    fields.push(
      [module === "one-to-one" ? "课堂状态与掌握情况" : "本次情况", observations.performance, 2000],
      ["值得肯定", observations.strengths, 2000],
      ["需要关注", observations.difficulties, 2000],
      ["下一步建议", observations.plan, 2000],
      [module === "one-to-one" ? "课后任务" : "个人任务", observations.tasks, 8000],
    );
    checkSubjects(Object.keys(observations.subjects), "个人观察中的科目");
    Object.values(observations.subjects).forEach((content, index) => {
      fields.push([`第 ${index + 1} 个科目的个人观察`, content, 2000]);
    });
  }
  for (const [label, value, limit] of fields)
    if (value.length > limit) errors.push(`${label}不能超过 ${limit} 字，请精简这栏内容。`);
  if (input.grade !== undefined && input.grade.length > 50)
    errors.push("学生档案中的年级不能超过 50 字，请先修改档案。");
  if (input.styleReference !== undefined && input.styleReference.length > 12000)
    errors.push("个人风格参考不能超过 12000 字，请精简后保存。");
  if (options.requirePersonalFacts && !hasPersonalFacts(observations))
    errors.push("先写一条真实观察，例如课堂情况、亮点、困难或学科记录。仅有后续计划或任务还不能生成个人反馈。");
  return errors;
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
