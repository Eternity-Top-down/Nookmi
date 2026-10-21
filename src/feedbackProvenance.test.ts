import { describe, expect, it } from "vitest";
import { emptyFeedbackEntry, parseBackup, pruneFeedbackForStudent, removeFeedbackRecord } from "./data";
import { defaultBrief, emptyObservations } from "./feedbackModel";
import { EMPTY_STUDENT, type AppData, type FeedbackAIDraft, type FeedbackSession, type ModuleId } from "./types";

const now = "2026-10-22T08:00:00.000Z";

function fixture(module: ModuleId = "one-to-one") {
  const individual = module === "one-to-one";
  const session: FeedbackSession = {
    id: "session-1", module, classId: individual ? null : "class-1", studentId: individual ? "student-1" : null,
    lessonAt: "2026-10-22T16:30", createdAt: now, updatedAt: now,
    entries: [{ studentId: "student-1", content: "最终稿：能列式，计算时需留意负号。", reviewed: true }],
  };
  const source: FeedbackAIDraft = {
    id: "source-1", sessionId: session.id, studentId: "student-1", content: "AI 原稿：能够列式，但计算需要关注符号。",
    input: {
      module, grade: "七年级", lessonAt: session.lessonAt,
      brief: defaultBrief(module, ["七年级"], new Date(2026, 9, 22)),
      observations: { ...emptyObservations(), performance: "能列式，移项会漏负号" },
    }, createdAt: now, model: "test-model",
  };
  session.entries[0].comparison = {
    source, finalContent: session.entries[0].content, finalInput: structuredClone(source.input), confirmedAt: now,
  };
  const data: AppData = {
    schemaVersion: 1, records: [],
    students: [{ ...EMPTY_STUDENT, id: "student-1", name: "测试学生", grade: "八年级", module, classId: session.classId, createdAt: now, updatedAt: now }],
    classes: individual ? [] : [{ id: "class-1", name: "测试班", grade: "八年级", module, schedule: "", notes: "", createdAt: now }],
    feedbackSessions: [session],
  };
  return { data, session, entry: session.entries[0], source };
}

const restore = (data: AppData) => parseBackup(JSON.stringify(data));

describe("feedback adoption provenance backups", () => {
  it.each<ModuleId>(["one-to-one", "evening", "course"])("round-trips %s source, input and final text without binding the old grade to the current profile", (module) => {
    const { data, source } = fixture(module);
    const restored = restore(data);
    expect(restored).toEqual(data);
    expect(restored.feedbackSessions![0].entries[0].comparison!.source).not.toBe(source);
    expect(restored.students[0].grade).toBe("八年级");
    expect(restored.feedbackSessions![0].entries[0].comparison!.source.input.grade).toBe("七年级");
  });

  it("retains a previous adoption while an edited draft is awaiting confirmation", () => {
    const { data, entry, source } = fixture();
    entry.reviewed = false;
    entry.content = "修改中的新稿";
    entry.aiDraft = { ...structuredClone(source), id: "new-source", content: "新生成并应用到编辑区的原稿" };
    expect(restore(data)).toEqual(data);
    entry.reviewed = true;
    expect(() => restore(data)).toThrow("最终稿不一致");
  });

  it("allows legacy or manually reviewed content without inventing an original", () => {
    const { data, entry } = fixture();
    delete entry.comparison;
    expect(restore(data)).toEqual(data);
    expect(restore(data).feedbackSessions![0].entries[0]).not.toHaveProperty("aiDraft");
    expect(restore(data).feedbackSessions![0].entries[0]).not.toHaveProperty("comparison");
  });

  it.each([
    ["source belongs to another lesson", "comparison.source.sessionId", "other-session"],
    ["source belongs to another student", "comparison.source.studentId", "other-student"],
    ["source belongs to another module", "comparison.source.input.module", "evening"],
    ["final input belongs to another module", "comparison.finalInput.module", "course"],
    ["invalid original timestamp", "comparison.source.createdAt", "2026-02-30T00:00:00.000Z"],
    ["out-of-range confirmation date", "comparison.confirmedAt", "2101-01-01T00:00:00.000Z"],
    ["invalid input lesson date", "comparison.source.input.lessonAt", "2026-02-30T16:30"],
    ["invalid final input period", "comparison.finalInput.brief.periodEnd", "2026-02-30"],
    ["non-text observation", "comparison.source.input.observations.strengths", false],
    ["too-long observation", "comparison.finalInput.observations.performance", "字".repeat(2001)],
    ["too-long original", "comparison.source.content", "字".repeat(10001)],
    ["empty original", "comparison.source.content", " \n"],
    ["too-long final", "comparison.finalContent", "字".repeat(10001)],
    ["too-long model", "comparison.source.model", "m".repeat(201)],
    ["too-long id", "comparison.source.id", "i".repeat(129)],
    ["invalid unicode", "comparison.source.input.observations.performance", "\ud800"],
    ["null comparison", "comparison", null],
    ["null original", "comparison.source", null],
    ["missing snapshot shape", "comparison.finalInput", {}],
    ["unexpected original field", "comparison.source.unrecognized", "preserve, do not discard silently"],
  ])("rejects %s rather than silently losing archive content", (_name, path, value) => {
    const { data, entry } = fixture();
    const keys = (path as string).split(".");
    let target = entry as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
    target[keys.at(-1)!] = value;
    expect(() => restore(data)).toThrow();
  });

  it.each([null, [], "text", 3, false])("rejects malformed current AI draft %j", (value) => {
    const { data, entry } = fixture();
    (entry as unknown as Record<string, unknown>).aiDraft = value;
    expect(() => restore(data)).toThrow();
  });

  it("cleans source and comparison along with the deleted feedback or student", () => {
    const { data, session, entry, source } = fixture("course");
    session.entries.push({ studentId: "student-2", content: "另一位学生的反馈" });
    entry.aiDraft = structuredClone(source);
    const removed = removeFeedbackRecord(data.feedbackSessions!, session.id, entry.studentId);
    expect(removed[0].entries[0]).toEqual(emptyFeedbackEntry(entry.studentId));
    expect(removed[0].entries[1].content).toBe("另一位学生的反馈");
    const pruned = pruneFeedbackForStudent(data.feedbackSessions!, entry.studentId);
    expect(pruned[0].entries).toEqual([session.entries[1]]);
    expect(removeFeedbackRecord(data.feedbackSessions!, session.id)).toEqual([]);
  });
});
