import { describe, expect, it } from "vitest";
import {
  adoptGeneratedFeedback,
  captureFeedbackInput,
  cloneFeedbackAsNewSession,
  resumeFeedbackEditing,
  setFeedbackReviewed,
} from "./feedbackComparisonModel";
import { defaultBrief, emptyObservations } from "./feedbackModel";
import type { FeedbackAIDraft, FeedbackEntry, FeedbackSession, ModuleId, Student } from "./types";

const generatedAt = "2026-10-22T10:00:00.000Z";
const confirmedAt = "2026-10-22T10:05:00.000Z";

function fixture(module: ModuleId = "one-to-one") {
  const student: Student = {
    id: "student-a", module, classId: module === "one-to-one" ? null : "class-a",
    name: "李亦琳", grade: "初二", school: "", guardian: "", phone: "", notes: "",
    createdAt: generatedAt, updatedAt: generatedAt,
  };
  const entry: FeedbackEntry = {
    studentId: student.id, content: "", reviewed: false,
    observations: { ...emptyObservations(), performance: "会联立求 x，不会写交点坐标", subjects: { 数学: "代入时算错" } },
  };
  const session: FeedbackSession = {
    id: "session-a", module, classId: student.classId, studentId: module === "one-to-one" ? student.id : null,
    lessonAt: "2026-10-22T18:00", createdAt: generatedAt, updatedAt: generatedAt,
    brief: { ...defaultBrief(module, [student.grade], new Date(2026, 9, 22)), teachingContent: "一次函数交点" },
    entries: [entry],
  };
  const input = captureFeedbackInput(session, student);
  const source: FeedbackAIDraft = {
    id: "generation-a", sessionId: session.id, studentId: student.id,
    content: "亦琳会求出 x，建议继续代入求 y 后写出坐标。", input, createdAt: generatedAt, model: "test-model",
  };
  return { student, entry, session, input, source };
}

function generated(module: ModuleId = "one-to-one") {
  const data = fixture(module);
  return { ...data, entry: adoptGeneratedFeedback(data.entry, data.source.content, "ai", "signature-a", data.source) };
}

describe("feedback comparison lifecycle", () => {
  it.each(["one-to-one", "evening", "course"] as ModuleId[])("archives only after confirmation in %s", (module) => {
    const { entry, input, source } = generated(module);
    expect(entry.comparison).toBeUndefined();
    expect(entry.aiDraft).toEqual(source);
    const edited = { ...entry, content: "亦琳已能求出 x，下一步练习代入求 y，再完整写出交点坐标。", generationSource: "manual" as const };
    const confirmed = setFeedbackReviewed(edited, true, input, confirmedAt);
    expect(confirmed.reviewed).toBe(true);
    expect(confirmed.aiDraft).toBeUndefined();
    expect(confirmed.comparison).toEqual({ source, finalContent: edited.content, finalInput: input, confirmedAt });
    expect(entry.comparison).toBeUndefined();
  });

  it("keeps the exact source snapshot independent of later changes to records", () => {
    const { entry, input, source } = generated();
    const finalInput = structuredClone(input);
    finalInput.observations.performance = "勘误：提醒后会联立求 x";
    const confirmed = setFeedbackReviewed({ ...entry, content: "提醒后能求出 x。" }, true, finalInput, confirmedAt);
    finalInput.observations.performance = "又改了记录";
    source.input.brief.subjects.push("物理");
    expect(confirmed.comparison!.source.input.observations.performance).toBe("会联立求 x，不会写交点坐标");
    expect(confirmed.comparison!.finalInput.observations.performance).toBe("勘误：提醒后会联立求 x");
    expect(confirmed.comparison!.source.input.brief.subjects).toEqual(["数学"]);
  });

  it("restores origin through draft serialization without creating an archive", () => {
    const { entry, input } = generated();
    const restored = JSON.parse(JSON.stringify({ ...entry, content: "编辑后的草稿" })) as FeedbackEntry;
    expect(restored.comparison).toBeUndefined();
    const confirmed = setFeedbackReviewed(restored, true, input, confirmedAt);
    expect(confirmed.comparison!.source.content).toBe(entry.aiDraft!.content);
    expect(confirmed.comparison!.finalContent).toBe("编辑后的草稿");
  });

  it("keeps one previous archive while ordinary edits continue the same source", () => {
    const { entry, input } = generated();
    const first = setFeedbackReviewed(entry, true, input, confirmedAt);
    const working = { ...resumeFeedbackEditing(first), reviewed: false, content: "再次修改后的正文" };
    expect(working.comparison).toEqual(first.comparison);
    expect(working.aiDraft).toEqual(first.comparison!.source);
    expect(first.aiDraft).toBeUndefined();
    const nextTime = "2026-10-22T10:15:00.000Z";
    const latest = setFeedbackReviewed(working, true, input, nextTime);
    expect(latest.comparison!.source).toEqual(first.comparison!.source);
    expect(latest.comparison!.finalContent).toBe("再次修改后的正文");
    expect(latest.comparison!.confirmedAt).toBe(nextTime);
    expect(latest.aiDraft).toBeUndefined();
  });

  it("withdraws explicit confirmation but retains the source for the working draft", () => {
    const { entry, input } = generated();
    const first = setFeedbackReviewed(entry, true, input, confirmedAt);
    const withdrawn = setFeedbackReviewed(first, false, input);
    expect(withdrawn.reviewed).toBe(false);
    expect(withdrawn.comparison).toBeUndefined();
    expect(withdrawn.aiDraft).toEqual(first.comparison!.source);
    expect(setFeedbackReviewed(withdrawn, true, input, confirmedAt).comparison).toEqual(first.comparison);
  });

  it("replaces an adopted generation and uses only its matching new source", () => {
    const { entry, input, source } = generated();
    const first = setFeedbackReviewed(entry, true, input, confirmedAt);
    const newSource = { ...source, id: "generation-b", content: "新的 AI 正文" };
    const replacing = adoptGeneratedFeedback(first, newSource.content, "ai", "signature-b", newSource);
    expect(replacing.comparison).toEqual(first.comparison);
    expect(replacing.aiDraft!.id).toBe("generation-b");
    const withdrawn = setFeedbackReviewed(replacing, false, input);
    expect(withdrawn.aiDraft!.id).toBe("generation-b");
    const latest = setFeedbackReviewed(replacing, true, input, confirmedAt);
    expect(latest.comparison!.source.id).toBe("generation-b");
    expect(latest.aiDraft).toBeUndefined();
  });

  it("does not turn an outline replacement into edits of an older AI output", () => {
    const { entry, input } = generated();
    const first = setFeedbackReviewed(entry, true, input, confirmedAt);
    const outline = adoptGeneratedFeedback(first, "按原始记录整理", "outline", "outline-signature");
    const manual = { ...resumeFeedbackEditing(outline), content: "老师手写的正文", generationSource: "manual" as const };
    expect(manual.aiDraft).toBeUndefined();
    expect(manual.comparison).toEqual(first.comparison);
    const checked = setFeedbackReviewed(manual, true, input, confirmedAt);
    expect(checked.reviewed).toBe(true);
    expect(checked.comparison).toBeUndefined();
    expect(setFeedbackReviewed(manual, false, input).aiDraft).toBeUndefined();
  });

  it("allows manually written and older feedback without fabricating AI text", () => {
    const { entry, input } = fixture();
    for (const reviewed of [false, true]) {
      const legacy = { ...entry, content: "早期保存的正文", reviewed };
      const checked = setFeedbackReviewed(resumeFeedbackEditing(legacy), true, input, confirmedAt);
      expect(checked.reviewed).toBe(true);
      expect(checked.comparison).toBeUndefined();
      expect(checked.aiDraft).toBeUndefined();
    }
  });

  it("retains no list of discarded generations or intermediate edits", () => {
    const { entry, input, source } = generated();
    let current = entry;
    for (let n = 0; n < 15; n++) {
      const candidate = { ...source, id: `generation-${n}`, content: `第 ${n} 份候选` };
      current = adoptGeneratedFeedback(current, candidate.content, "ai", "signature", candidate);
      if (n % 3 === 0) current = setFeedbackReviewed(current, true, input, confirmedAt);
    }
    current = setFeedbackReviewed(current, true, input, confirmedAt);
    const serialized = JSON.stringify(current);
    expect(current.aiDraft).toBeUndefined();
    expect(current.comparison!.source.id).toBe("generation-14");
    expect(serialized).not.toContain('"generation-13"');
    expect(serialized).not.toContain('"generation-0"');
  });

  it("is idempotent when an already confirmed entry is marked confirmed again", () => {
    const { entry, input } = generated();
    const first = setFeedbackReviewed(entry, true, input, confirmedAt);
    expect(setFeedbackReviewed(first, true, input, "2026-10-22T12:00:00.000Z")).toEqual(first);
  });

  it("rejects wrong-student provenance and mismatched AI content", () => {
    const { entry, input, source } = fixture();
    const foreign = { ...source, studentId: "student-b" };
    expect(() => adoptGeneratedFeedback(entry, source.content, "ai", "sig", foreign)).toThrow("学生不匹配");
    expect(() => adoptGeneratedFeedback(entry, "另一个正文", "ai", "sig", source)).toThrow("生成内容不匹配");
    expect(() => adoptGeneratedFeedback(entry, source.content, "ai", "sig")).toThrow("生成内容不匹配");
    expect(() => setFeedbackReviewed({ ...entry, content: source.content, aiDraft: foreign }, true, input)).toThrow("学生不匹配");
  });

  it("rejects cross-module source and blank adoption", () => {
    const { entry, input } = generated();
    expect(() => setFeedbackReviewed(entry, true, { ...input, module: "course" })).toThrow("模块不匹配");
    expect(() => setFeedbackReviewed({ ...entry, content: " \n " }, true, input)).toThrow("请先完成反馈正文");
  });
});

describe("generation input snapshots and copied drafts", () => {
  it("deep-copies the current records and supports observations missing from legacy data", () => {
    const { session, student } = fixture();
    const snapshot = captureFeedbackInput(session, student);
    session.brief!.subjects.push("物理");
    session.entries[0].observations!.subjects.数学 = "改写";
    student.grade = "初三";
    expect(snapshot.brief.subjects).toEqual(["数学"]);
    expect(snapshot.observations.subjects.数学).toBe("代入时算错");
    expect(snapshot.grade).toBe("初二");
    delete session.entries[0].observations;
    expect(captureFeedbackInput(session, student).observations).toEqual(emptyObservations());
  });

  it("refuses to capture another student's or module's records", () => {
    const { session, student } = fixture();
    expect(() => captureFeedbackInput(session, { ...student, id: "student-b" })).toThrow("课程和学生记录");
    expect(() => captureFeedbackInput(session, { ...student, module: "evening" })).toThrow("课程和学生记录");
    expect(() => captureFeedbackInput({ ...session, brief: undefined }, student)).toThrow("课程和学生记录");
  });

  it("copies a confirmed entry into a new draft with original source but no confirmation", () => {
    const { session, entry, input } = generated();
    session.entries = [setFeedbackReviewed(entry, true, input, confirmedAt)];
    const original = structuredClone(session);
    const copy = cloneFeedbackAsNewSession(session, "session-b", confirmedAt);
    expect(copy.id).toBe("session-b");
    expect(copy.createdAt).toBe(confirmedAt);
    expect(copy.entries[0].reviewed).toBe(false);
    expect(copy.entries[0].comparison).toBeUndefined();
    expect(copy.entries[0].aiDraft!.sessionId).toBe("session-b");
    expect(copy.entries[0].aiDraft!.content).toBe(entry.content);
    expect(session).toEqual(original);
    copy.entries[0].aiDraft!.input.observations.subjects.数学 = "副本中修改";
    expect(session).toEqual(original);
  });

  it("copies the newer AI lineage and does not copy a stale archived source into manual replacement", () => {
    const { session, entry, input, source } = generated();
    const reviewed = setFeedbackReviewed(entry, true, input, confirmedAt);
    const newer = { ...source, id: "generation-b", content: "更新正文" };
    session.entries = [adoptGeneratedFeedback(reviewed, newer.content, "ai", "sig", newer)];
    expect(cloneFeedbackAsNewSession(session, "session-b").entries[0].aiDraft!.id).toBe("generation-b");
    session.entries = [adoptGeneratedFeedback(reviewed, "手写整理", "outline", "sig")];
    expect(cloneFeedbackAsNewSession(session, "session-c").entries[0].aiDraft).toBeUndefined();
  });

  it("does not allow copy recovery to reuse an identity or accept another session's source", () => {
    const { session, entry } = generated();
    session.entries = [entry];
    expect(() => cloneFeedbackAsNewSession(session, session.id)).toThrow("独立的编号");
    session.entries[0].aiDraft!.sessionId = "another-session";
    expect(() => cloneFeedbackAsNewSession(session, "session-b")).toThrow("当前反馈不匹配");
  });
});
