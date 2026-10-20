import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyFeedbackText,
  currentLocalLessonAt,
  formatClassFeedback,
  formatStudentFeedback,
  isValidLessonAt,
} from "./feedback";
import { EMPTY_STUDENT, type FeedbackSession, type Student } from "./types";

const students: Student[] = ["小林", "小陈", "小周"].map((name, index) => ({
  ...EMPTY_STUDENT,
  id: `student-${index}`,
  name,
  module: "course",
  classId: "class-1",
  createdAt: "2026-10-21T10:00:00.000Z",
  updatedAt: "2026-10-21T10:00:00.000Z",
}));
const session: FeedbackSession = {
  id: "feedback-1",
  module: "course",
  classId: "class-1",
  studentId: null,
  lessonAt: "2026-10-21T19:30",
  entries: [
    { studentId: students[2].id, content: "  " },
    { studentId: students[1].id, content: "小陈的独立反馈。" },
    {
      studentId: students[0].id,
      content: "  今天完成了练习。\n\n下次继续讨论证明过程。  ",
    },
  ],
  createdAt: "2026-10-21T12:00:00.000Z",
  updatedAt: "2026-10-21T12:00:00.000Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("feedback text", () => {
  it("copies only the selected student's content and preserves paragraphs", () => {
    const text = formatStudentFeedback(session, students[0], "初二 A 班");
    expect(text).toContain("学生：小林");
    expect(text).toContain("初二 A 班");
    expect(text).toContain("2026年10月21日 19:30");
    expect(text).toContain("今天完成了练习。\n\n下次继续讨论证明过程。");
    expect(text).not.toContain("小陈");
    expect(text).not.toContain("小周");
  });

  it("skips blank and missing feedback instead of producing empty messages", () => {
    expect(formatStudentFeedback(session, students[2])).toBe("");
    expect(
      formatStudentFeedback({ ...session, entries: [] }, students[0]),
    ).toBe("");
    expect(formatClassFeedback({ ...session, entries: [] }, students)).toBe("");
  });

  it("batch copy follows the roster, omits blanks, and does not repeat a student", () => {
    const text = formatClassFeedback(session, [...students, students[0]]);
    expect(text.indexOf("学生：小林")).toBeLessThan(text.indexOf("学生：小陈"));
    expect(text.match(/学生：小林/g)).toHaveLength(1);
    expect(text).not.toContain("学生：小周");
  });
});

describe("lesson wall-clock time", () => {
  it("validates calendar dates and minutes without silently rolling them forward", () => {
    expect(isValidLessonAt("2024-02-29T23:59")).toBe(true);
    expect(isValidLessonAt("2026-02-29T19:30")).toBe(false);
    expect(isValidLessonAt("2026-04-31T19:30")).toBe(false);
    expect(isValidLessonAt("2026-10-21T24:00")).toBe(false);
    expect(isValidLessonAt("2026-10-21T19:60")).toBe(false);
    expect(isValidLessonAt("2026-10-21T19:30Z")).toBe(false);
    expect(isValidLessonAt("1899-12-31T19:30")).toBe(false);
  });

  it("uses local date parts, retaining a late evening lesson's calendar day", () => {
    const date = new Date(2026, 9, 21, 23, 45);
    expect(currentLocalLessonAt(date)).toBe("2026-10-21T23:45");
  });
});

describe("clipboard failure handling", () => {
  it("rejects when permission is denied so UI can offer manual copying", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    await expect(copyFeedbackText("家长反馈")).rejects.toThrow("手动");
  });

  it("rejects unsupported clipboard and blank content without reporting success", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyFeedbackText("家长反馈")).rejects.toThrow("手动");
    await expect(copyFeedbackText(" \n")).rejects.toThrow("没有");
  });
});
