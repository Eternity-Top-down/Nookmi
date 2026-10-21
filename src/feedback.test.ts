import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyFeedbackText,
  currentLocalLessonAt,
  defaultOneToOneTitle,
  formatClassFeedback,
  formatFeedbackPeriod,
  formatOneToOneTitle,
  formatStudentFeedback,
  getOneToOneTitle,
  isValidLessonNumber,
  isValidLessonAt,
  resolveLessonNumber,
  suggestNextLessonNumber,
  updateOneToOneTitleDate,
  withSuggestedLessonNumbers,
} from "./feedback";
import { defaultBrief } from "./feedbackModel";
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
  it("labels weekly and monthly feedback by the selected period while keeping legacy wording", () => {
    const weekly = {
      ...session,
      module: "evening" as const,
      brief: defaultBrief("evening", ["初二"], new Date(2026, 9, 21)),
    };
    const monthly = {
      ...session,
      brief: defaultBrief("course", ["初二"], new Date(2026, 9, 21)),
    };
    expect(formatFeedbackPeriod(weekly)).toBe(
      "周反馈 · 2026.10.19 — 2026.10.23",
    );
    expect(formatFeedbackPeriod(monthly)).toBe(
      "月反馈 · 2026.10.01 — 2026.10.31",
    );
    expect(formatStudentFeedback(weekly, students[0])).toContain("晚辅周反馈");
    expect(formatStudentFeedback(monthly, students[0])).toContain("班课月反馈");
    expect(formatStudentFeedback(session, students[0])).toContain(
      "上课时间：2026年10月21日 19:30",
    );
  });
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

describe("one-to-one course titles", () => {
  const student = { ...students[0], name: "李亦琳", module: "one-to-one" as const, classId: null };
  const lesson: FeedbackSession = { ...session, module: "one-to-one", classId: null, studentId: student.id, lessonNumber: 8,
    entries: [{ studentId: student.id, content: "本节课能独立订正。\n\n建议复习数列公式。" }] };

  it("copies the friendly course title and original paragraphs without a generic metadata wrapper", () => {
    expect(formatOneToOneTitle(lesson, student)).toBe("亦琳第8次数学课（10.21）");
    expect(formatStudentFeedback(lesson, student)).toBe("亦琳第8次数学课（10.21）\n\n本节课能独立订正。\n\n建议复习数列公式。");
    expect(formatOneToOneTitle(lesson, { ...student, name: "张瑶" })).toBe("张瑶第8次数学课（10.21）");
  });

  it("uses selected subjects and local calendar dates including midnight", () => {
    const subjectLesson = { ...lesson, lessonAt: "2026-01-02T00:00", brief: { ...defaultBrief("one-to-one", ["初二"]), subjects: ["物理"] } };
    expect(formatOneToOneTitle(subjectLesson, student)).toBe("亦琳第8次物理课（1.2）");
    expect(formatOneToOneTitle({ ...subjectLesson, brief: { ...subjectLesson.brief, subjects: [] } }, student)).toContain("数学课");
  });

  it.each([
    "亦琳第8次数学课（10.21）", "李亦琳第7次数学课（10.4）", "**亦琳第6次数学课（10.2）**",
  ])("preserves an existing same-student title without prepending another: %s", (title) => {
    const content = `${title}\n\n这是原有正文。`;
    const saved = { ...lesson, entries: [{ studentId: student.id, content }] };
    expect(formatStudentFeedback(saved, student)).toBe(content);
    expect(saved.entries[0].content).toBe(content);
  });

  it("does not mistake ordinary body text or another student's title for the current title", () => {
    for (const content of ["亦琳第8次数学课表现认真。", "张瑶第8次数学课（10.21）\n原文保留。", "📖 1. 课堂学习内容\n学习了数列。"])
      expect(formatStudentFeedback({ ...lesson, entries: [{ studentId: student.id, content }] }, student))
        .toBe(`亦琳第8次数学课（10.21）\n\n${content}`);
  });

  it("suggests old courses in chronological order within each student without rewriting explicit numbers", () => {
    const old = { ...lesson, id: "old", lessonAt: "2026-10-01T18:00", lessonNumber: undefined };
    const recent = { ...lesson, id: "recent", lessonAt: "2026-10-02T18:00", lessonNumber: undefined };
    const assigned = { ...lesson, id: "assigned", lessonAt: "2026-10-03T18:00", lessonNumber: 8 };
    const other = { ...old, id: "other", studentId: "other-student" };
    const input = [recent, other, assigned, old, session];
    const before = structuredClone(input);
    expect(resolveLessonNumber(old, input)).toBe(1);
    expect(resolveLessonNumber(recent, input)).toBe(2);
    expect(resolveLessonNumber(assigned, input)).toBe(8);
    expect(resolveLessonNumber({ ...recent, lessonNumber: 0 }, input)).toBe(0);
    expect(withSuggestedLessonNumbers(input).map((item) => item.lessonNumber)).toEqual([2, 1, 8, 1, undefined]);
    expect(suggestNextLessonNumber(input, student.id)).toBe(9);
    expect(suggestNextLessonNumber(input, "new-student")).toBe(1);
    expect(input).toEqual(before);
  });

  it("keeps legacy integer boundaries but wraps new suggestions into ten-course cycles", () => {
    expect(isValidLessonNumber(1)).toBe(true);
    expect(isValidLessonNumber(9999)).toBe(true);
    for (const number of [0, -1, 1.5, 10000, NaN, Infinity, "8", null, undefined]) expect(isValidLessonNumber(number)).toBe(false);
    expect(suggestNextLessonNumber([{ ...lesson, lessonNumber: 9999 }], student.id)).toBe(10);
  });

  it("prefers an editable title, including an intentional empty edit, without rewriting saved records", () => {
    expect(getOneToOneTitle({ ...lesson, title: "亦琳本周数学学习反馈" }, student)).toBe("亦琳本周数学学习反馈");
    expect(getOneToOneTitle({ ...lesson, title: "" }, student)).toBe("");
    expect(getOneToOneTitle({ ...lesson, title: " \n " }, student)).toBe("");
    const old = { ...lesson, entries: [{ studentId: student.id, content: "亦琳第6次数学课（10.2）\n\n原正文。" }] };
    expect(getOneToOneTitle(old, student)).toBe("亦琳第6次数学课（10.2）");
    expect(old).not.toHaveProperty("title");
  });

  it("copies a custom title once and replaces only an existing complete same-student title line", () => {
    const title = "亦琳第9次数学课（10.22）";
    const content = "**李亦琳第8次数学课（10.21）**\r\n\r\n📖 原正文。\r\n\r\n① 原有第二段。";
    const custom = { ...lesson, title, entries: [{ studentId: student.id, content }] };
    expect(formatStudentFeedback(custom, student)).toBe(`${title}\r\n\r\n📖 原正文。\r\n\r\n① 原有第二段。`);
    expect(custom.entries[0].content).toBe(content);
    const same = { ...lesson, title: "阶段学习回顾", entries: [{ studentId: student.id, content: "阶段学习回顾\n\n原正文。" }] };
    expect(formatStudentFeedback(same, student)).toBe("阶段学习回顾\n\n原正文。");
  });

  it("continues the most recent course title rather than an older high count, then wraps ten back to one", () => {
    const older = { ...lesson, id: "older", lessonAt: "2026-10-01T18:00", title: "亦琳第10次数学课（10.1）", updatedAt: "2026-12-01T12:00:00Z" };
    const recent = { ...lesson, id: "recent", lessonAt: "2026-10-20T18:00", title: "亦琳第8次数学课（10.20）", lessonNumber: 3 };
    const draft = { ...lesson, id: "new", lessonAt: "2026-10-21T18:00" };
    expect(defaultOneToOneTitle(draft, student, [older, recent])).toBe("亦琳第9次数学课（10.21）");
    expect(defaultOneToOneTitle(draft, student, [{ ...recent, title: "亦琳第10次数学课（10.20）" }, older])).toBe("亦琳第1次数学课（10.21）");
    expect(defaultOneToOneTitle(draft, student, [draft, recent, older])).toBe("亦琳第9次数学课（10.21）");
  });

  it("reads legacy body titles before legacy numbers, then falls back to the student's recorded order", () => {
    const recent = { ...lesson, id: "recent", lessonAt: "2026-10-20T18:00", entries: [{ studentId: student.id, content: "亦琳第10次数学课（10.20）\n\n原正文。" }] };
    const draft = { ...lesson, id: "new" };
    expect(defaultOneToOneTitle(draft, student, [recent])).toContain("第1次");
    expect(defaultOneToOneTitle(draft, student, [{ ...recent, entries: lesson.entries, title: "本周课堂回顾" }])).toContain("第9次");
    expect(defaultOneToOneTitle(draft, student, [{ ...recent, entries: lesson.entries, lessonNumber: undefined }])).toContain("第2次");
    expect(defaultOneToOneTitle(draft, student, [{ ...recent, studentId: "another-student" }])).toContain("第1次");
  });

  it("updates only a standard matching date suffix and preserves custom title wording or dates", () => {
    expect(updateOneToOneTitleDate("亦琳第9次数学课（10.21）", "2026-10-21T18:00", "2026-10-22T19:00")).toBe("亦琳第9次数学课（10.22）");
    expect(updateOneToOneTitleDate("亦琳复习课(10.21)", "2026-10-21T18:00", "2026-11-02T19:00")).toBe("亦琳复习课(11.2)");
    for (const title of ["亦琳阶段回顾", "亦琳第9次数学课（10.20）"]) expect(updateOneToOneTitleDate(title, "2026-10-21T18:00", "2026-10-22T19:00")).toBe(title);
    expect(updateOneToOneTitleDate("亦琳第9次数学课（10.21）", "2026-10-21T18:00", "")).toBe("亦琳第9次数学课（10.21）");
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
