import type { FeedbackSession, Student } from "./types";

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
  const title = `${MODULE_LABELS[session.module]}课后反馈${className?.trim() ? ` · ${className.trim()}` : ""}`;
  return `${title}\n学生：${student.name}\n上课时间：${formatLessonAt(session.lessonAt)}\n\n${content}`;
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
