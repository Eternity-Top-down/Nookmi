import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FeedbackHistory, { FeedbackHistoryDetail } from "./FeedbackHistory";
import { historicalFeedbackCopy, sortFeedbackHistory } from "./feedbackHistoryModel";
import { defaultBrief, emptyObservations } from "./feedbackModel";
import { EMPTY_STUDENT, type FeedbackSession, type Student } from "./types";

const now = "2026-10-21T10:00:00.000Z";
const students: Student[] = ["测试学生甲", "测试学生乙"].map((name, index) => ({
  ...EMPTY_STUDENT, id: `student-${index}`, name, grade: "高一", module: "course",
  classId: "class-1", createdAt: now, updatedAt: now,
}));
const record = (id: string, lessonAt: string, overrides: Partial<FeedbackSession> = {}): FeedbackSession => ({
  id, module: "one-to-one", classId: null, studentId: students[0].id,
  lessonAt, createdAt: now, updatedAt: now,
  entries: [{ studentId: students[0].id, content: "认真完成练习。", reviewed: true }],
  ...overrides,
});

describe("historical feedback dates", () => {
  it("orders by actual lesson time even if an older course was edited later, without mutating input", () => {
    const older = record("older", "2026-10-10T18:00", { updatedAt: "2026-10-30T10:00:00Z" });
    const morning = record("morning", "2026-10-20T09:00");
    const evening = record("evening", "2026-10-20T18:00");
    const input = [older, morning, evening];
    expect(sortFeedbackHistory(input).map((item) => item.id)).toEqual(["evening", "morning", "older"]);
    expect(input).toEqual([older, morning, evening]);
  });

  it.each(["evening", "course"] as const)("uses %s period end then start, and supports old records without brief", (module) => {
    const brief = defaultBrief(module, ["高一"], new Date(2026, 9, 21));
    const a = record("a", "2026-10-01T00:00", { module, brief: { ...brief, periodStart: "2026-10-01", periodEnd: "2026-10-25" } });
    const b = record("b", "2026-10-02T00:00", { module, brief: { ...brief, periodStart: "2026-10-02", periodEnd: "2026-10-25" } });
    const legacy = record("legacy", "2026-10-15T18:00", { module });
    expect(sortFeedbackHistory([legacy, a, b]).map((item) => item.id)).toEqual(["b", "a", "legacy"]);
  });

  it("keeps tied records stable and places invalid dates after dated records", () => {
    const a = record("a", "2026-10-10T18:00");
    const b = record("b", "2026-10-10T18:00", { updatedAt: "2026-10-30T10:00:00Z" });
    const invalid = record("invalid", "");
    expect(sortFeedbackHistory([invalid, a, b]).map((item) => item.id)).toEqual(["a", "b", "invalid"]);
  });
});

describe("historical feedback copy", () => {
  const group = record("group", "2026-10-01T00:00", {
    module: "course", classId: "class-1", studentId: null,
    brief: defaultBrief("course", ["高一"], new Date(2026, 9, 21)),
    entries: [{ studentId: students[0].id, content: "甲的已核对反馈。", reviewed: true },
      { studentId: students[1].id, content: "乙的待核对反馈。", reviewed: false }],
  });

  it("includes every nonempty saved body and identifies unreviewed text without dropping it", () => {
    const result = historicalFeedbackCopy(group, students, "测试班");
    expect(result.count).toBe(2);
    expect(result.unreviewed).toBe(1);
    expect(result.text).toContain("甲的已核对反馈。");
    expect(result.text).toContain("乙的待核对反馈。");
    expect(result.text).toContain("班课月反馈 · 测试班");
    expect(result.text).toContain("2026.10.01 — 2026.10.31");
  });

  it("copies only the selected student's content and never includes classmates", () => {
    const result = historicalFeedbackCopy(group, students, "测试班", students[1].id);
    expect(result.count).toBe(1);
    expect(result.unreviewed).toBe(1);
    expect(result.text).toContain("乙的待核对反馈。");
    expect(result.text).not.toContain("甲的已核对反馈。");
    expect(historicalFeedbackCopy(group, [students[1]], "测试班")).toEqual(result);
  });

  it("omits blank bodies, deduplicates roster entries, and provides no copy text for unknown students", () => {
    const blank = { ...group, entries: [{ ...group.entries[0], content: " \n " }, group.entries[1]] };
    expect(historicalFeedbackCopy(blank, [...students, students[1]]).count).toBe(1);
    expect(historicalFeedbackCopy(blank, students, undefined, students[0].id)).toEqual({ text: "", count: 0, unreviewed: 0 });
    expect(historicalFeedbackCopy(group, students, undefined, "missing").text).toBe("");
  });
});

describe("history list and read-only detail", () => {
  it("shows separate detail and quick copy controls in chronological order with review status", () => {
    const older = record("older", "2026-10-10T18:00");
    const newer = record("newer", "2026-10-20T18:00", { entries: [{ ...older.entries[0], reviewed: false }] });
    const html = renderToStaticMarkup(<FeedbackHistory sessions={[older, newer]} students={[students[0]]} />);
    expect(html.indexOf("2026年10月20日")).toBeLessThan(html.indexOf("2026年10月10日"));
    expect(html).toContain("查看详情");
    expect(html).toContain("快速复制");
    expect(html).toContain("1 人待核对");
    expect(html).not.toContain("最近编辑优先");
    expect(html).not.toContain("<textarea");
  });

  it("disables quick copy for a record without a body", () => {
    const session = record("blank", "2026-10-20T18:00", { entries: [] });
    const html = renderToStaticMarkup(<FeedbackHistory sessions={[session]} students={[students[0]]} />);
    expect(html).toMatch(/<button[^>]+disabled=""[^>]+aria-label="[^"]*快速复制"/);
    expect(html).toContain("已记录，待完成正文");
  });

  it("shows saved teaching content, all observation fields and body, with one-to-one legacy tasks merged", () => {
    const session = record("detail", "2026-10-20T18:00", {
      brief: { ...defaultBrief("one-to-one", ["高一"]), teachingContent: "等差数列", commonTasks: "复习公式", focus: "突出独立思考" },
      entries: [{ studentId: students[0].id, content: "已保存的完整正文。", reviewed: false,
        observations: { ...emptyObservations(), performance: "能独立订正", strengths: "计算准确", difficulties: "递推较弱", plan: "练习变形", tasks: "订正错题", subjects: { 数学: "基础良好" } } }],
    });
    const before = structuredClone(session);
    const html = renderToStaticMarkup(<FeedbackHistoryDetail session={session} students={students} onCopy={() => undefined} />);
    for (const text of ["等差数列", "突出独立思考", "已保存的完整正文。", "能独立订正", "计算准确", "递推较弱", "练习变形", "复习公式", "订正错题", "基础良好", "待核对"]) expect(html).toContain(text);
    expect(html).not.toMatch(/<textarea|<input|全班安排/);
    expect(session).toEqual(before);
  });
});
