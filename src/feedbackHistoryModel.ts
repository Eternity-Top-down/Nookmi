import { formatClassFeedback, formatStudentFeedback, isValidLessonAt } from "./feedback";
import type { FeedbackSession, Student } from "./types";

function validDay(value: string | undefined): string {
  return value && isValidLessonAt(`${value}T00:00`) ? value : "";
}

/** Course time is independent of when an old feedback record was edited. */
export function sortFeedbackHistory(sessions: readonly FeedbackSession[]): FeedbackSession[] {
  const time = (session: FeedbackSession) => {
    const lesson = isValidLessonAt(session.lessonAt) ? session.lessonAt : "";
    if (session.module === "one-to-one") return [lesson, ""];
    return [validDay(session.brief?.periodEnd) || validDay(session.brief?.periodStart) || lesson,
      validDay(session.brief?.periodStart) || lesson];
  };
  return [...sessions].sort((a, b) => {
    const left = time(a);
    const right = time(b);
    return right[0].localeCompare(left[0]) || right[1].localeCompare(left[1]);
  });
}

/** Copy saved text, including unreviewed text, with its status made explicit in the UI. */
export function historicalFeedbackCopy(session: FeedbackSession, students: Student[], className?: string, studentId?: string) {
  const roster = students.filter((student, index) =>
    (!studentId || student.id === studentId) && students.findIndex((item) => item.id === student.id) === index);
  const entries = roster.flatMap((student) => {
    const entry = session.entries.find((item) => item.studentId === student.id);
    return entry?.content.trim() ? [entry] : [];
  });
  const text = studentId
    ? roster[0] ? formatStudentFeedback(session, roster[0], className) : ""
    : formatClassFeedback(session, roster, className);
  return { text, count: entries.length, unreviewed: entries.filter((entry) => !entry.reviewed).length };
}
