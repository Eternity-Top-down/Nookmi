import type { FeedbackSession, Student } from "./types";
import { friendlyStudentName } from "./studentAddress";

const MODULE_LABELS = {
  "one-to-one": "一对一",
  evening: "晚辅",
  course: "班课",
} as const;

/** A lesson's wall-clock time stays local; do not convert it through UTC. */
export function currentLocalLessonAt(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function isValidLessonAt(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (
    year < 1900 ||
    year > 2100 ||
    Number(hourText) > 23 ||
    Number(minuteText) > 59
  ) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function formatLessonAt(value: string): string {
  if (!isValidLessonAt(value)) return value;
  const [day, time] = value.split("T");
  const [year, month, date] = day.split("-");
  return `${year}年${Number(month)}月${Number(date)}日 ${time}`;
}

export function formatFeedbackPeriod(session: FeedbackSession): string {
  if (session.module === "one-to-one" || !session.brief) {
    return formatLessonAt(session.lessonAt);
  }
  const { periodStart, periodEnd } = session.brief;
  const label = session.module === "evening" ? "周反馈" : "月反馈";
  return `${label} · ${periodStart.replace(/-/g, ".")} — ${periodEnd.replace(/-/g, ".")}`;
}

export function isValidLessonNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 9999;
}

/** Missing legacy numbers are display suggestions based on this student's recorded courses.
 * Never rewrite a saved number or an invalid draft value; the teacher can correct the suggestion.
 */
export function resolveLessonNumber(session: FeedbackSession, sessions: readonly FeedbackSession[]): number {
  if (session.lessonNumber !== undefined) return session.lessonNumber;
  const sameStudent = sessions.filter((item) => item.module === "one-to-one" && item.studentId === session.studentId && item.id !== session.id);
  sameStudent.push(session);
  sameStudent.sort((a, b) => a.lessonAt.localeCompare(b.lessonAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return Math.min(sameStudent.findIndex((item) => item.id === session.id) + 1, 9999);
}

/** Resolve an entire history once while keeping its original order and saved objects unchanged. */
export function withSuggestedLessonNumbers(sessions: readonly FeedbackSession[]): FeedbackSession[] {
  const groups = new Map<string | null, FeedbackSession[]>();
  for (const session of sessions) {
    if (session.module !== "one-to-one") continue;
    const group = groups.get(session.studentId) ?? [];
    group.push(session);
    groups.set(session.studentId, group);
  }
  const suggested = new Map<string, number>();
  for (const group of groups.values()) {
    group.sort((a, b) => a.lessonAt.localeCompare(b.lessonAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    group.forEach((session, index) => suggested.set(session.id, Math.min(index + 1, 9999)));
  }
  return sessions.map((session) => session.module === "one-to-one" && session.lessonNumber === undefined
    ? { ...session, lessonNumber: suggested.get(session.id)! } : session);
}

function lessonNumberInTitle(title: string | undefined): number | undefined {
  const match = title?.match(/第\s*([1-9]\d{0,3})\s*次/);
  return match ? Number(match[1]) : undefined;
}

/** Continue the latest course in time (not the highest historical number), in ten-course cycles. */
export function suggestNextLessonNumber(sessions: readonly FeedbackSession[], studentId: string | null, student?: Student): number {
  const sameStudent = sessions.filter((session) => session.module === "one-to-one" && session.studentId === studentId)
    .sort((a, b) => b.lessonAt.localeCompare(a.lessonAt) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const latest = sameStudent[0];
  if (!latest) return 1;
  const bodyTitle = student ? existingOneToOneTitle(latest.entries.find((entry) => entry.studentId === studentId)?.content.trim() ?? "", student) : null;
  const number = lessonNumberInTitle(latest.title) ?? lessonNumberInTitle(bodyTitle ?? undefined)
    ?? (isValidLessonNumber(latest.lessonNumber) ? latest.lessonNumber : resolveLessonNumber({ ...latest, lessonNumber: undefined }, sameStudent));
  return number % 10 + 1;
}

export function formatOneToOneTitle(session: FeedbackSession, student: Student): string {
  const number = session.lessonNumber ?? 1;
  const subjects = session.brief?.subjects.map((subject) => subject.trim()).filter(Boolean).join("、") || "数学";
  const course = subjects.endsWith("课") ? subjects : `${subjects}课`;
  const [yearMonthDay] = session.lessonAt.split("T");
  const [, month, day] = yearMonthDay.split("-");
  const date = isValidLessonAt(session.lessonAt) ? `${Number(month)}.${Number(day)}` : "日期待填写";
  return `${friendlyStudentName(student.name)}第${isValidLessonNumber(number) ? number : "？"}次${course}（${date}）`;
}

/** Recognize only a complete, first-line course title belonging to this student.
 * Preserve an existing handwritten title rather than silently changing its number or date.
 */
export function existingOneToOneTitle(content: string, student: Student): string | null {
  const firstLine = content.split(/\r?\n/, 1)[0].trim().replace(/^\*\*(.+)\*\*$/, "$1");
  const matches = [...new Set([student.name.trim(), friendlyStudentName(student.name)])].some((name) => {
    if (!name || !firstLine.startsWith(name)) return false;
    const remainder = firstLine.slice(name.length);
    return /^第[1-9]\d{0,3}次[^\r\n（）()]{1,30}课[（(]\d{1,2}[.月/-]\d{1,2}日?[）)]$/.test(remainder);
  });
  return matches ? firstLine : null;
}

/** Explicit titles include intentional empty edits; never overwrite them with a generated default. */
export function getOneToOneTitle(session: FeedbackSession, student: Student, sessions: readonly FeedbackSession[] = []): string {
  if (session.title !== undefined) return session.title.trim();
  const content = session.entries.find((entry) => entry.studentId === student.id)?.content.trim() ?? "";
  return existingOneToOneTitle(content, student)
    ?? formatOneToOneTitle({ ...session, lessonNumber: resolveLessonNumber(session, sessions) }, student);
}

export function defaultOneToOneTitle(session: FeedbackSession, student: Student, sessions: readonly FeedbackSession[]): string {
  return formatOneToOneTitle({ ...session, lessonNumber: suggestNextLessonNumber(sessions.filter((item) => item.id !== session.id), student.id, student) }, student);
}

/** Only follow a recognizable date suffix matching the prior lesson date; preserve custom wording. */
export function updateOneToOneTitleDate(title: string, previousLessonAt: string, nextLessonAt: string): string {
  if (!isValidLessonAt(previousLessonAt) || !isValidLessonAt(nextLessonAt)) return title;
  const shortDay = (value: string) => {
    const [, month, day] = value.split("T")[0].split("-");
    return `${Number(month)}.${Number(day)}`;
  };
  for (const [open, close] of [["（", "）"], ["(", ")"]]) {
    const previous = `${open}${shortDay(previousLessonAt)}${close}`;
    if (title.endsWith(previous)) return `${title.slice(0, -previous.length)}${open}${shortDay(nextLessonAt)}${close}`;
  }
  return title;
}

/** Export only the selected student's feedback, never classmates' content. */
export function formatStudentFeedback(
  session: FeedbackSession,
  student: Student,
  className?: string,
): string {
  const content = session.entries
    .find((entry) => entry.studentId === student.id)
    ?.content.trim();
  if (!content) return "";
  if (session.module === "one-to-one") {
    const existingTitle = existingOneToOneTitle(content, student);
    if (session.title !== undefined) {
      const title = session.title.trim();
      if (title && content.split(/\r?\n/, 1)[0].trim().replace(/^\*\*(.+)\*\*$/, "$1") === title) return content;
      if (existingTitle) {
        const lineBreak = content.search(/\r?\n/);
        const remainder = lineBreak < 0 ? "" : content.slice(lineBreak);
        return title ? `${title}${remainder}` : remainder.trimStart();
      }
      return title ? `${title}\n\n${content}` : content;
    }
    if (existingTitle) return content;
    return `${formatOneToOneTitle(session, student)}\n\n${content}`;
  }
  const cycle =
    session.brief
      ? session.module === "evening"
        ? "周反馈"
        : "月反馈"
      : "课后反馈";
  const title = `${MODULE_LABELS[session.module]}${cycle}${className?.trim() ? ` · ${className.trim()}` : ""}`;
  const timeLabel = session.brief ? "反馈周期" : "上课时间";
  return `${title}\n学生：${student.name}\n${timeLabel}：${formatFeedbackPeriod(session)}\n\n${content}`;
}

/** Keep roster order and omit students whose feedback is still blank. */
export function formatClassFeedback(
  session: FeedbackSession,
  students: Student[],
  className?: string,
): string {
  const seen = new Set<string>();
  return students
    .filter((student) => {
      if (seen.has(student.id)) return false;
      seen.add(student.id);
      return true;
    })
    .map((student) => formatStudentFeedback(session, student, className))
    .filter(Boolean)
    .join("\n\n────────────\n\n");
}

export async function copyFeedbackText(text: string): Promise<void> {
  if (!text.trim()) throw new Error("还没有可复制的反馈内容。");
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof navigator.clipboard.writeText !== "function"
  ) {
    throw new Error("当前浏览器无法自动复制，请手动选择并复制下方文字。");
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    throw new Error("浏览器未允许自动复制，请手动选择并复制下方文字。");
  }
}
