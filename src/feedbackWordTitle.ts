import type { FeedbackSession } from "./types";

interface MonthWeek { year: number; month: number; week: number }

function monthWeek(day: string | undefined): MonthWeek | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  if (year < 1900 || year > 2100) return null;
  const parsed = new Date(Date.UTC(year, month - 1, date));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== date) return null;
  // Calendar weeks start on Monday; the week containing the 1st is week 1.
  const firstDayOffset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  return { year, month, week: Math.ceil((date + firstDayOffset) / 7) };
}

/** Use the feedback's dates, including when exporting an old session later. */
export function feedbackWordPeriodLabel(session: FeedbackSession): string {
  const from = monthWeek(session.brief?.periodStart);
  const to = monthWeek(session.brief?.periodEnd);
  const fallback = monthWeek(session.lessonAt.slice(0, 10));
  const start = from ?? to ?? fallback;
  const end = to ?? from ?? fallback;
  if (!start || !end) return "";
  const prefix = `${start.year}年${start.month}月第${start.week}`;
  if (start.year === end.year && start.month === end.month) {
    return start.week === end.week ? `${prefix}周` : `${prefix}—${end.week}周`;
  }
  return `${prefix}周—${start.year === end.year ? "" : `${end.year}年`}${end.month}月第${end.week}周`;
}

export function defaultFeedbackWordTitle(session: FeedbackSession, className?: string): string {
  return [
    className?.trim(),
    feedbackWordPeriodLabel(session),
    session.module === "evening" ? "晚辅反馈" : "班课反馈",
  ].filter(Boolean).join(" ");
}
