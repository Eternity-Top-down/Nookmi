import { describe, expect, it } from "vitest";
import {
  canApplyGeneration,
  defaultBrief,
  defaultSubjects,
  emptyObservations,
  entryIsStale,
  feedbackSnapshot,
  generationSignature,
  hasFeedbackContent,
  hasObservations,
  hasPersonalFacts,
  outlineFeedback,
  sortFeedbackByRecentEdit,
} from "./feedbackModel";
import type { FeedbackSession } from "./types";

function fixture(): FeedbackSession {
  return {
    id: "feedback-1",
    module: "evening",
    classId: "class-1",
    studentId: null,
    lessonAt: "2026-10-19T00:00",
    brief: defaultBrief("evening", ["初二"], new Date(2026, 9, 21, 12)),
    entries: [
      {
        studentId: "student-1",
        content: "",
        observations: emptyObservations(),
      },
    ],
    createdAt: "2026-10-21T10:00:00.000Z",
    updatedAt: "2026-10-21T10:00:00.000Z",
  };
}

describe("feedback periods and subject defaults", () => {
  it("reopens a newly edited monthly draft instead of a later-dated legacy lesson", () => {
    const legacy = {
      ...fixture(),
      id: "legacy",
      lessonAt: "2026-10-21T19:30",
      updatedAt: "2026-10-21T10:00:00.000Z",
    };
    const monthly = {
      ...fixture(),
      id: "monthly",
      module: "course" as const,
      lessonAt: "2026-10-01T00:00",
      updatedAt: "2026-10-21T19:00:00+08:00",
    };
    const source = [legacy, monthly];
    expect(
      sortFeedbackByRecentEdit(source).map((session) => session.id),
    ).toEqual(["monthly", "legacy"]);
    expect(source[0].id).toBe("legacy");
  });
  it("uses Monday through Friday even when opened on a Sunday across months", () => {
    const brief = defaultBrief(
      "evening",
      ["初二"],
      new Date(2026, 10, 1, 23, 59),
    );
    expect(brief.periodStart).toBe("2026-10-26");
    expect(brief.periodEnd).toBe("2026-10-30");
  });
  it("keeps the full calendar month including leap February", () => {
    const brief = defaultBrief("course", ["初三"], new Date(2024, 1, 10));
    expect([brief.periodStart, brief.periodEnd]).toEqual([
      "2024-02-01",
      "2024-02-29",
    ]);
  });
  it("uses the lesson day for one-on-one and defaults evening subjects by grade", () => {
    const brief = defaultBrief(
      "one-to-one",
      ["初三"],
      new Date(2026, 9, 21, 23),
    );
    expect([brief.periodStart, brief.periodEnd]).toEqual([
      "2026-10-21",
      "2026-10-21",
    ]);
    expect(defaultSubjects("evening", ["八年级"])).toEqual(["数学", "物理"]);
    expect(defaultSubjects("evening", ["初二", "初三"])).toEqual([
      "数学",
      "物理",
      "化学",
    ]);
    expect(defaultSubjects("course", ["初三"])).toEqual(["数学"]);
    expect(emptyObservations()).toEqual({
      performance: "",
      strengths: "",
      difficulties: "",
      plan: "",
      tasks: "",
      subjects: {},
    });
  });
});

describe("facts, drafts, and faithful local organization", () => {
  it("allows an unfinished plan to be saved without treating it as observed classroom facts", () => {
    const session = fixture();
    const observations = {
      ...emptyObservations(),
      plan: "下周练习移项",
      tasks: "两道巩固题",
    };
    session.entries[0].observations = observations;
    expect(hasObservations(observations)).toBe(true);
    expect(hasPersonalFacts(observations)).toBe(false);
    expect(hasFeedbackContent(session)).toBe(true);
    expect(
      hasPersonalFacts({
        ...observations,
        subjects: { 物理: "已完成力的示意图练习" },
      }),
    ).toBe(true);
  });
  it("does not save a session merely because dates and default subjects exist", () => {
    const session = fixture();
    expect(hasFeedbackContent(session)).toBe(false);
    session.brief!.teachingContent = "分式运算";
    expect(hasFeedbackContent(session)).toBe(true);
  });
  it("organizes only entered facts and does not turn an internal instruction into a family-facing claim", () => {
    const session = fixture();
    session.brief!.teachingContent = "分式运算";
    session.brief!.focus = "语气温和一些，不要虚构成绩";
    const observations = {
      ...emptyObservations(),
      difficulties: "通分时会漏乘",
      subjects: { 物理: "能画出重力方向", 化学: "" },
      plan: "下周练习两组通分",
    };
    const text = outlineFeedback("evening", session.brief!, observations);
    expect(text).toContain("分式运算");
    expect(text).toContain("通分时会漏乘");
    expect(text).toContain("能画出重力方向");
    expect(text).toContain("下周练习两组通分");
    expect(text).not.toContain("化学情况");
    expect(text).not.toContain("语气温和");
    expect(text).not.toContain("进步显著");
    expect(
      outlineFeedback("evening", session.brief!, emptyObservations()),
    ).toBe("");
  });
});

describe("generated content provenance and concurrent edits", () => {
  it("uses a compact stable signature independent of record key insertion order", () => {
    const session = fixture();
    const first = {
      ...emptyObservations(),
      subjects: { 数学: "能独立计算", 物理: "能标出重力方向" },
    };
    const second = {
      ...emptyObservations(),
      subjects: { 物理: "能标出重力方向", 数学: "能独立计算" },
    };
    const a = generationSignature(
      "evening",
      session.brief!,
      first,
      "初二",
      session.lessonAt,
    );
    const b = generationSignature(
      "evening",
      session.brief!,
      second,
      "初二",
      session.lessonAt,
    );
    expect(a).toBe(b);
    expect(a.length).toBeLessThan(256);
    expect(a).not.toContain("能独立");
    expect(
      generationSignature(
        "evening",
        { ...session.brief!, teachingContent: "新增章节" },
        first,
        "初二",
        session.lessonAt,
      ),
    ).not.toBe(a);
    expect(
      generationSignature(
        "evening",
        session.brief!,
        first,
        "初三",
        session.lessonAt,
      ),
    ).not.toBe(a);
  });
  it("flags changed source without treating legacy hand-written content as stale AI output", () => {
    expect(
      entryIsStale(
        { studentId: "s", content: "原文", generatedFrom: "old" },
        "new",
      ),
    ).toBe(true);
    expect(
      entryIsStale({ studentId: "s", content: "旧版手写正文" }, "new"),
    ).toBe(false);
    expect(
      entryIsStale(
        { studentId: "s", content: "", generatedFrom: "old" },
        "new",
      ),
    ).toBe(false);
  });
  it("rejects responses after a course switch, common edit, or any teacher edit to that student", () => {
    const started = { epoch: 1, context: 3, entry: 7 };
    expect(canApplyGeneration(started, { ...started })).toBe(true);
    expect(canApplyGeneration(started, { ...started, epoch: 2 })).toBe(false);
    expect(canApplyGeneration(started, { ...started, context: 4 })).toBe(false);
    expect(canApplyGeneration(started, { ...started, entry: 8 })).toBe(false);
  });
  it("does not let save timestamps hide edits made after a save started", () => {
    const before = fixture();
    const submitted = feedbackSnapshot(before);
    expect(
      feedbackSnapshot({ ...before, updatedAt: "2026-10-21T11:00:00.000Z" }),
    ).toBe(submitted);
    const edited = structuredClone(before);
    edited.entries[0].observations!.strengths = "保存期间补写的真实情况";
    expect(feedbackSnapshot(edited)).not.toBe(submitted);
  });
});
