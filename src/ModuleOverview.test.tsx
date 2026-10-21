import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { groupOverviewStudents, moduleFeedbackItems, OverviewFeedbackList, OverviewStudentList, searchOverviewStudents } from "./ModuleOverview";
import { historicalFeedbackCopy } from "./feedbackHistoryModel";
import { defaultBrief } from "./feedbackModel";
import { EMPTY_STUDENT, type ClassGroup, type FeedbackSession, type Student } from "./types";

const now = "2026-10-21T08:00:00.000Z";
const classes: ClassGroup[] = [
  { id: "course-a", module: "course", name: "高一周六班", grade: "高一", schedule: "", notes: "", createdAt: now },
  { id: "course-b", module: "course", name: "高一周日班", grade: "高一", schedule: "", notes: "", createdAt: now },
  { id: "evening-a", module: "evening", name: "初二晚辅班", grade: "初二", schedule: "", notes: "", createdAt: now },
];
const students: Student[] = [
  { ...EMPTY_STUDENT, id: "a", module: "course", classId: "course-a", name: "李亦琳", grade: "高一", school: "一中", createdAt: now, updatedAt: now },
  { ...EMPTY_STUDENT, id: "b", module: "course", classId: "course-b", name: "张瑶", grade: "高一", school: "二中", createdAt: now, updatedAt: now },
  { ...EMPTY_STUDENT, id: "c", module: "evening", classId: "evening-a", name: "晚辅学生", grade: "初二", school: "三中", createdAt: now, updatedAt: now },
];
function session(id: string, overrides: Partial<FeedbackSession> = {}): FeedbackSession {
  return { id, module: "course", classId: "course-a", studentId: null, lessonAt: "2026-10-01T09:00", createdAt: now, updatedAt: now,
    brief: { ...defaultBrief("course", ["高一"]), periodStart: "2026-10-01", periodEnd: "2026-10-20" },
    entries: [{ studentId: "a", content: "甲的反馈正文。", reviewed: true }], ...overrides };
}

describe("module overview saved feedback boundaries", () => {
  it("limits records to the requested module and preserves the actual class name for copy", () => {
    const records = [session("a"), session("b", { classId: "course-b", entries: [{ studentId: "b", content: "乙的反馈正文。", reviewed: false }] }),
      session("evening", { module: "evening", classId: "evening-a", entries: [{ studentId: "c", content: "晚辅正文" }] })];
    const items = moduleFeedbackItems("course", records, students, classes);
    expect(items.map((item) => item.session.id)).toEqual(["a", "b"]);
    expect(items.map((item) => item.count)).toEqual([1, 1]);
    const copied = historicalFeedbackCopy(items[1].session, items[1].students, items[1].className);
    expect(copied.text).toContain("高一周日班");
    expect(copied.text).toContain("乙的反馈正文。");
    expect(copied.text).not.toMatch(/甲的反馈|晚辅正文|高一周六班/);
    expect(copied.unreviewed).toBe(1);
  });

  it("does not count blank drafts, deleted students, missing classes or cross-class entries", () => {
    const records = [session("blank", { entries: [{ studentId: "a", content: " \n " }] }),
      session("removed", { entries: [{ studentId: "removed-student", content: "旧反馈" }] }),
      session("wrong-class", { entries: [{ studentId: "b", content: "不属于此班" }] }),
      session("no-class", { classId: "missing" }), session("good")];
    expect(moduleFeedbackItems("course", records, students, classes).map((item) => item.session.id)).toEqual(["good"]);
    expect(moduleFeedbackItems("evening", records, students, classes)).toEqual([]);
  });

  it("orders class periods by their actual dates instead of latest edit and never mutates stored data", () => {
    const older = session("older", { updatedAt: "2026-12-01T08:00:00Z" });
    const newer = session("newer", { brief: { ...older.brief!, periodEnd: "2026-11-20" } });
    const original = structuredClone([older, newer]);
    expect(moduleFeedbackItems("course", [older, newer], students, classes).map((item) => item.session.id)).toEqual(["newer", "older"]);
    expect([older, newer]).toEqual(original);
  });

  it("resolves one-to-one legacy lesson titles per student, includes earlier drafts in numbering, and keeps friendly names", () => {
    const roster: Student[] = students.slice(0, 2).map((student) => ({ ...student, module: "one-to-one", classId: null }));
    const records = [session("first", { module: "one-to-one", classId: null, studentId: "a", entries: [{ studentId: "a", content: "" }] }),
      session("second", { module: "one-to-one", classId: null, studentId: "a", lessonAt: "2026-10-21T18:00" }),
      session("other-student", { module: "one-to-one", classId: null, studentId: "b", entries: [{ studentId: "b", content: "另一位的反馈。" }] })];
    const items = moduleFeedbackItems("one-to-one", records, roster, classes);
    expect(items).toHaveLength(2);
    expect(items[0].title).toContain("亦琳第2次数学课（10.21）");
    expect(items[1].title).toContain("张瑶第1次数学课");
    const copied = historicalFeedbackCopy(items[0].session, items[0].students, items[0].className);
    expect(copied.text).toMatch(/^亦琳第2次数学课（10.21）\n\n甲的反馈正文。$/);
  });
});

describe("module student browsing", () => {
  it("searches names, schools and class names without modifying roster order", () => {
    expect(searchOverviewStudents(students, classes, "亦琳").map((student) => student.id)).toEqual(["a"]);
    expect(searchOverviewStudents(students, classes, "二中").map((student) => student.id)).toEqual(["b"]);
    expect(searchOverviewStudents(students, classes, " 周日 ").map((student) => student.id)).toEqual(["b"]);
    expect(searchOverviewStudents(students, classes, "不存在")).toEqual([]);
  });

  it("groups grades with counts, places unfilled grades last and retains empty classes", () => {
    const roster = [...students, { ...students[0], id: "no-grade", grade: "" }];
    const grades = groupOverviewStudents("grades", roster, classes);
    expect(grades.map((group) => [group.label, group.students.length])).toEqual([["初二", 1], ["高一", 2], ["未填写年级", 1]]);
    const groups = groupOverviewStudents("classes", [], classes);
    expect(groups.map((group) => group.label)).toEqual(classes.map((group) => group.name));
    expect(groups.every((group) => group.students.length === 0)).toBe(true);
  });

  it("renders distinguishable student actions including their school and class context", () => {
    const html = renderToStaticMarkup(<OverviewStudentList students={students.slice(0, 2)} classes={classes} onStudent={() => undefined} />);
    expect(html).toContain('aria-label="查看李亦琳的学生档案"');
    expect(html).toContain("高一 · 一中 · 高一周六班");
    expect(html).toContain("高一 · 二中 · 高一周日班");
    expect(html).not.toContain("晚辅学生");
  });

  it("renders separate detail and copy actions with the owner and review state", () => {
    const items = moduleFeedbackItems("course", [session("saved", { entries: [{ studentId: "a", content: "需要核对的正文。", reviewed: false }] })], students, classes);
    const html = renderToStaticMarkup(<OverviewFeedbackList items={items} copying={false} onDetail={() => undefined} onCopy={() => undefined} />);
    expect(html).toContain("高一周六班");
    expect(html).toContain("1 人待核对");
    expect(html).toContain("查看详情");
    expect(html).toContain("快速复制");
    expect(html).not.toMatch(/<textarea|<input/);
    const busy = renderToStaticMarkup(<OverviewFeedbackList items={items} copying onDetail={() => undefined} onCopy={() => undefined} />);
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*aria-label="快速复制/);
  });
});
