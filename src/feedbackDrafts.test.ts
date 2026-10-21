import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearFeedbackDrafts,
  clearStudentFeedbackDraft,
  deleteFeedbackWithDraftRecovery,
  feedbackDraftScope,
  pruneStudentFeedbackDrafts,
  readFeedbackDrafts,
  removeFeedbackDraft,
  writeFeedbackDraft,
  type FeedbackDraftRecord,
  type FeedbackDraftStorage,
} from "./feedbackDrafts";
import { defaultBrief, emptyObservations, feedbackSnapshot } from "./feedbackModel";
import { emptyFeedbackEntry, removeFeedbackRecord } from "./data";
import type { FeedbackAIDraft, ModuleId } from "./types";

class MemoryStorage implements FeedbackDraftStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

function record(module: ModuleId = "one-to-one", target = "student-1", sessionId = "feedback-1"): FeedbackDraftRecord {
  return {
    session: {
      id: sessionId, module,
      classId: module === "one-to-one" ? null : target,
      studentId: module === "one-to-one" ? target : null,
      lessonAt: "2026-10-21T18:30",
      brief: defaultBrief(module, ["初二"], new Date(2026, 9, 21)),
      entries: [{
        studentId: module === "one-to-one" ? target : "student-1",
        content: "未保存的反馈正文",
        observations: { ...emptyObservations(), performance: "还在补写的真实观察" },
        reviewed: false, generationSource: "manual", generatedFrom: "origin",
      }],
      createdAt: "2026-10-21T10:00:00.000Z", updatedAt: "2026-10-21T10:00:00.000Z",
    },
    baselineSnapshot: '{"entries":[{"content":"服务器原正文"}]}',
    subjectText: "数学、 物理，", selectedId: module === "one-to-one" ? target : "student-1",
    savedAt: "2026-10-21T11:00:00.000Z",
  };
}

const scopeOf = (value: FeedbackDraftRecord) =>
  feedbackDraftScope(value.session.module, value.session.classId, value.session.studentId);

function sourceFor(draft: FeedbackDraftRecord): FeedbackAIDraft {
  return {
    id: "source-1", sessionId: draft.session.id, studentId: draft.session.entries[0].studentId,
    content: "原始 AI 反馈", createdAt: draft.savedAt, model: "test-model",
    input: {
      module: draft.session.module, grade: "初二", lessonAt: draft.session.lessonAt,
      brief: structuredClone(draft.session.brief!), observations: structuredClone(draft.session.entries[0].observations!),
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("feedback recovery storage", () => {
  it("recovers the current AI original and most recent adoption while preserving unfinished new input", () => {
    const storage = new MemoryStorage();
    const draft = record();
    const source = sourceFor(draft);
    const entry = draft.session.entries[0];
    entry.comparison = { source, finalContent: "之前采用的最终稿", finalInput: structuredClone(source.input), confirmedAt: draft.savedAt };
    entry.aiDraft = { ...structuredClone(source), id: "new-source", content: "当前正在编辑的原稿" };
    draft.session.lessonAt = "";
    draft.session.brief!.periodStart = "";
    entry.observations!.performance = "字".repeat(2001);
    expect(writeFeedbackDraft(scopeOf(draft), draft, storage).ok).toBe(true);
    expect(readFeedbackDrafts(scopeOf(draft), storage)).toEqual({ drafts: [draft], error: null });
  });

  it.each(["aiDraft", "comparison"])("retains corrupt %s bytes and refuses to overwrite them on recovery", (field) => {
    const storage = new MemoryStorage();
    const draft = record();
    const entry = draft.session.entries[0];
    const source = sourceFor(draft);
    entry.aiDraft = source;
    entry.comparison = { source: structuredClone(source), finalContent: "已采用稿", finalInput: structuredClone(source.input), confirmedAt: draft.savedAt };
    const scope = scopeOf(draft);
    expect(writeFeedbackDraft(scope, draft, storage).ok).toBe(true);
    const key = storage.key(0)!;
    const stored = JSON.parse(storage.getItem(key)!);
    if (field === "aiDraft") stored.record.session.entries[0].aiDraft.sessionId = "wrong-session";
    else stored.record.session.entries[0].comparison.source.studentId = "wrong-student";
    const corrupt = JSON.stringify(stored);
    storage.setItem(key, corrupt);
    expect(readFeedbackDrafts(scope, storage).drafts).toEqual([]);
    expect(readFeedbackDrafts(scope, storage).error).toContain("原数据已保留");
    expect(writeFeedbackDraft(scope, draft, storage).ok).toBe(false);
    expect(storage.getItem(key)).toBe(corrupt);
  });

  it("removes both archive and original from local draft and baseline when clearing a student's feedback", () => {
    const storage = new MemoryStorage();
    const draft = record("course", "class-1");
    const source = sourceFor(draft);
    draft.session.entries[0].aiDraft = source;
    draft.session.entries[0].comparison = { source: structuredClone(source), finalContent: "已采用稿", finalInput: structuredClone(source.input), confirmedAt: draft.savedAt };
    draft.session.entries.push({ studentId: "student-2", content: "另一位学生的反馈" });
    draft.baselineSnapshot = JSON.stringify(draft.session);
    const scope = scopeOf(draft);
    expect(writeFeedbackDraft(scope, draft, storage).ok).toBe(true);
    expect(clearStudentFeedbackDraft(scope, draft.session.id, "student-1", true, storage).ok).toBe(true);
    const restored = readFeedbackDrafts(scope, storage).drafts[0];
    expect(restored.session.entries[0]).toEqual(emptyFeedbackEntry("student-1"));
    expect(JSON.parse(restored.baselineSnapshot).entries[0]).toEqual(emptyFeedbackEntry("student-1"));
    expect(restored.session.entries[1]).toEqual(draft.session.entries[1]);
  });

  it("preserves a cleared or unfinished title without dropping the rest of the local draft", () => {
    for (const title of ["", "亦琳第9次数学课（10.21）", "字".repeat(301)]) {
      const storage = new MemoryStorage();
      const draft = record();
      draft.session.title = title;
      expect(writeFeedbackDraft(scopeOf(draft), draft, storage).ok).toBe(true);
      expect(readFeedbackDrafts(scopeOf(draft), storage)).toEqual({ drafts: [draft], error: null });
    }
  });

  it("preserves unfinished lesson numbers locally so a refresh cannot discard a partially edited course", () => {
    for (const lessonNumber of [0, -1, 1.5, 10000, 8]) {
      const storage = new MemoryStorage();
      const draft = record();
      draft.session.lessonNumber = lessonNumber;
      expect(writeFeedbackDraft(scopeOf(draft), draft, storage).ok).toBe(true);
      expect(readFeedbackDrafts(scopeOf(draft), storage)).toEqual({ drafts: [draft], error: null });
    }
  });

  it("round-trips full unfinished content, including invalid dates, oversized text and raw subject input", () => {
    const storage = new MemoryStorage();
    const draft = record();
    draft.session.lessonAt = "";
    draft.session.brief!.periodStart = "";
    draft.session.brief!.periodEnd = "2026-02-30";
    draft.session.brief!.subjects = ["数学", "数学", ""];
    draft.session.brief!.teachingContent = "课".repeat(5001);
    draft.session.entries[0].content = "未".repeat(10001);
    draft.session.entries[0].observations!.tasks = "题".repeat(8001);
    draft.session.entries[0].observations!.subjects = { "": "暂未填写科目名称" };
    draft.subjectText = "数学，，化学、、  未整理\n";
    const original = structuredClone(draft);
    expect(writeFeedbackDraft(scopeOf(draft), draft, storage)).toEqual({ ok: true, error: null });
    const restored = readFeedbackDrafts(scopeOf(draft), storage);
    expect(restored).toEqual({ drafts: [original], error: null });
    expect(restored.drafts[0]).not.toBe(draft);
    expect(draft).toEqual(original);
  });

  it("keeps multiple lessons without eviction and sorts by local recovery save time", () => {
    const storage = new MemoryStorage();
    const old = record("one-to-one", "student-1", "old");
    old.session.lessonAt = "2026-10-25T20:00";
    const newest = record("one-to-one", "student-1", "new");
    newest.savedAt = "2026-10-21T12:00:00.000Z";
    const oldest = record("one-to-one", "student-1", "oldest");
    oldest.savedAt = "2025-10-21T10:00:00.000Z";
    for (const draft of [newest, old, oldest]) expect(writeFeedbackDraft(scopeOf(draft), draft, storage).ok).toBe(true);
    expect(readFeedbackDrafts(scopeOf(old), storage).drafts.map((item) => item.session.id)).toEqual(["new", "old", "oldest"]);
    expect(storage.length).toBe(3);
  });

  it("isolates students, classes and modules even when session IDs are the same", () => {
    const storage = new MemoryStorage();
    const drafts = [record(), record("one-to-one", "student-2"), record("evening", "class-1"), record("course", "class-1"), record("course", "class-2")];
    for (const draft of drafts) expect(writeFeedbackDraft(scopeOf(draft), draft, storage).ok).toBe(true);
    expect(storage.length).toBe(drafts.length);
    for (const draft of drafts) expect(readFeedbackDrafts(scopeOf(draft), storage).drafts).toEqual([draft]);
  });

  it("does not collide delimiter-like target IDs or prototype property names", () => {
    const storage = new MemoryStorage();
    for (const target of ["a:b", "a%3Ab", "a/b", "__proto__", "constructor", "学生:一"]) {
      const draft = record("one-to-one", target, "id:part/%");
      expect(writeFeedbackDraft(scopeOf(draft), draft, storage).ok).toBe(true);
      expect(readFeedbackDrafts(scopeOf(draft), storage).drafts[0]).toEqual(draft);
    }
    expect(storage.length).toBe(6);
  });

  it("retains legacy sessions without optional feedback metadata", () => {
    const storage = new MemoryStorage();
    const draft = record();
    delete draft.session.brief;
    draft.session.entries = [{ studentId: "student-1", content: "旧版正文的未保存修改" }];
    expect(writeFeedbackDraft(scopeOf(draft), draft, storage).ok).toBe(true);
    expect(readFeedbackDrafts(scopeOf(draft), storage).drafts).toEqual([draft]);
  });

  it("supports an empty class roster without fabricating a selected student", () => {
    const storage = new MemoryStorage();
    const draft = record("course", "empty-class");
    draft.session.entries = [];
    draft.selectedId = "";
    expect(writeFeedbackDraft(scopeOf(draft), draft, storage).ok).toBe(true);
    expect(readFeedbackDrafts(scopeOf(draft), storage).drafts).toEqual([draft]);
  });

  it("rejects a cross-target write and a different student's one-on-one entry", () => {
    const storage = new MemoryStorage();
    const draft = record();
    const scope = scopeOf(draft);
    expect(writeFeedbackDraft(scope, draft, storage).ok).toBe(true);
    const before = new Map(storage.data);
    expect(writeFeedbackDraft(scope, record("one-to-one", "student-2"), storage).ok).toBe(false);
    draft.session.entries[0].studentId = "student-2";
    expect(writeFeedbackDraft(scope, draft, storage).ok).toBe(false);
    expect(storage.data).toEqual(before);
  });

  it.each([
    (draft: FeedbackDraftRecord) => { draft.selectedId = "another-student"; },
    (draft: FeedbackDraftRecord) => { draft.savedAt = "not-a-date"; },
    (draft: FeedbackDraftRecord) => { draft.session.entries.push(structuredClone(draft.session.entries[0])); },
    (draft: FeedbackDraftRecord) => { (draft.session.entries[0] as unknown as Record<string, unknown>).content = 42; },
    (draft: FeedbackDraftRecord) => { (draft.session.brief as unknown as Record<string, unknown>).subjects = "数学"; },
    (draft: FeedbackDraftRecord) => { (draft.session.entries[0].observations as unknown as Record<string, unknown>).subjects = []; },
  ])("rejects corrupt structure without overwriting a valid recovery copy %#", (corrupt) => {
    const storage = new MemoryStorage();
    const draft = record();
    const scope = scopeOf(draft);
    writeFeedbackDraft(scope, draft, storage);
    const before = new Map(storage.data);
    corrupt(draft);
    expect(writeFeedbackDraft(scope, draft, storage)).toMatchObject({ ok: false, error: expect.stringContaining("结构或教学目标不匹配") });
    expect(storage.data).toEqual(before);
  });

  it("reports damaged records while preserving them and returning other usable drafts", () => {
    const storage = new MemoryStorage();
    const good = record();
    const damaged = record("one-to-one", "student-1", "damaged");
    const scope = scopeOf(good);
    writeFeedbackDraft(scope, damaged, storage);
    const damagedKey = storage.key(0)!;
    storage.setItem(damagedKey, "{broken json");
    writeFeedbackDraft(scope, good, storage);
    expect(readFeedbackDrafts(scope, storage)).toEqual({ drafts: [good], error: expect.stringContaining("1 条损坏或归属不符") });
    expect(storage.getItem(damagedKey)).toBe("{broken json");
    expect(writeFeedbackDraft(scope, damaged, storage)).toMatchObject({ ok: false, error: expect.stringContaining("未覆盖原数据") });
    expect(storage.getItem(damagedKey)).toBe("{broken json");
  });

  it.each(["scope", "session", "key", "version"])("reports mismatched stored %s instead of restoring another target's content", (field) => {
    const storage = new MemoryStorage();
    const draft = record();
    const scope = scopeOf(draft);
    writeFeedbackDraft(scope, draft, storage);
    const key = storage.key(0)!;
    const stored = JSON.parse(storage.getItem(key)!);
    if (field === "scope") stored.scope = scopeOf(record("one-to-one", "student-2"));
    if (field === "session") stored.record = record("one-to-one", "student-2");
    if (field === "key") stored.record.session.id = "another-session";
    if (field === "version") stored.version = 999;
    storage.setItem(key, JSON.stringify(stored));
    const before = storage.getItem(key);
    expect(readFeedbackDrafts(scope, storage)).toEqual({ drafts: [], error: expect.stringContaining("归属不符") });
    expect(storage.getItem(key)).toBe(before);
  });

  it("reports quota failure without evicting or altering any previous draft", () => {
    const storage = new MemoryStorage();
    const draft = record();
    const scope = scopeOf(draft);
    writeFeedbackDraft(scope, draft, storage);
    const before = new Map(storage.data);
    storage.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
    draft.session.entries[0].content = "新增但存储失败的输入";
    expect(writeFeedbackDraft(scope, draft, storage)).toEqual({ ok: false, error: expect.stringContaining("存储空间不足") });
    expect(storage.data).toEqual(before);
  });

  it("reports denied access even when the browser localStorage getter itself throws", () => {
    vi.stubGlobal("window", Object.defineProperty({}, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } }));
    const draft = record();
    const scope = scopeOf(draft);
    expect(readFeedbackDrafts(scope)).toEqual({ drafts: [], error: expect.stringContaining("存储权限") });
    expect(writeFeedbackDraft(scope, draft)).toMatchObject({ ok: false, error: expect.stringContaining("存储权限") });
    expect(removeFeedbackDraft(scope, draft.session.id).ok).toBe(false);
    expect(clearFeedbackDrafts(scope).ok).toBe(false);
  });

  it("works during SSR without touching a browser or throwing", () => {
    vi.stubGlobal("window", undefined);
    const draft = record();
    const scope = scopeOf(draft);
    expect(readFeedbackDrafts(scope)).toEqual({ drafts: [], error: null });
    expect(writeFeedbackDraft(scope, draft)).toMatchObject({ ok: false, error: expect.stringContaining("不支持") });
    expect(removeFeedbackDraft(scope, draft.session.id)).toEqual({ ok: true, error: null });
    expect(clearFeedbackDrafts()).toEqual({ ok: true, error: null });
  });

  it("uses browser storage by default when it is available", () => {
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const draft = record();
    expect(writeFeedbackDraft(scopeOf(draft), draft).ok).toBe(true);
    expect(readFeedbackDrafts(scopeOf(draft)).drafts).toEqual([draft]);
  });
});

describe("explicit recovery cleanup", () => {
  it("removes just the requested lesson, leaving other lessons and targets intact", () => {
    const storage = new MemoryStorage();
    const first = record();
    const second = record("one-to-one", "student-1", "second");
    const another = record("one-to-one", "student-2");
    for (const draft of [first, second, another]) writeFeedbackDraft(scopeOf(draft), draft, storage);
    expect(removeFeedbackDraft(scopeOf(first), first.session.id, storage).ok).toBe(true);
    expect(readFeedbackDrafts(scopeOf(first), storage).drafts).toEqual([second]);
    expect(readFeedbackDrafts(scopeOf(another), storage).drafts).toEqual([another]);
    expect(removeFeedbackDraft(scopeOf(first), "not-present", storage).ok).toBe(true);
  });

  it("clears all requested-scope keys including corrupt entries without touching other app data", () => {
    const storage = new MemoryStorage();
    const first = record();
    const second = record("one-to-one", "student-1", "second");
    const another = record("course", "class-1");
    storage.setItem("nookmi:data:v1", "other app data");
    for (const draft of [first, second, another]) writeFeedbackDraft(scopeOf(draft), draft, storage);
    const firstKey = [...storage.data.keys()].find((key) => key !== "nookmi:data:v1")!;
    storage.setItem(firstKey, "{broken json");
    expect(clearFeedbackDrafts(scopeOf(first), storage).ok).toBe(true);
    expect(readFeedbackDrafts(scopeOf(first), storage)).toEqual({ drafts: [], error: null });
    expect(readFeedbackDrafts(scopeOf(another), storage).drafts).toEqual([another]);
    expect(clearFeedbackDrafts(undefined, storage).ok).toBe(true);
    expect(storage.data).toEqual(new Map([["nookmi:data:v1", "other app data"]]));
  });

  it("does not delete any keys when enumeration is blocked and reports partial cleanup failures", () => {
    const storage = new MemoryStorage();
    const draft = record();
    writeFeedbackDraft(scopeOf(draft), draft, storage);
    const before = new Map(storage.data);
    storage.key = () => { throw new DOMException("blocked", "SecurityError"); };
    expect(clearFeedbackDrafts(undefined, storage).ok).toBe(false);
    expect(storage.data).toEqual(before);
    storage.removeItem = () => { throw new Error("storage unavailable"); };
    expect(removeFeedbackDraft(scopeOf(draft), draft.session.id, storage)).toMatchObject({ ok: false, error: expect.stringContaining("未能全部清理") });
    expect(storage.data).toEqual(before);
  });

  it("rejects malformed scopes instead of falling back to clearing every scope", () => {
    const storage = new MemoryStorage();
    const draft = record();
    writeFeedbackDraft(scopeOf(draft), draft, storage);
    const before = new Map(storage.data);
    expect(clearFeedbackDrafts("", storage).ok).toBe(false);
    expect(readFeedbackDrafts("[]", storage).error).toContain("教学目标无效");
    expect(removeFeedbackDraft("invalid", "x", storage).ok).toBe(false);
    expect(() => feedbackDraftScope("one-to-one", "class-1", "student-1")).toThrow("教学模块");
    expect(storage.data).toEqual(before);
  });
});

describe("deleted student recovery cleanup", () => {
  function classDraft(module: "evening" | "course" = "evening", sessionId = "feedback-1") {
    const draft = record(module, "class-1", sessionId);
    draft.session.entries[0].content = "被删除学生的旧反馈";
    draft.session.entries.push({
      studentId: "student-2", content: "其他学生尚未保存的完整正文",
      observations: { ...emptyObservations(), difficulties: "其他学生尚未保存的真实困难" },
      reviewed: false, generationSource: "manual",
    });
    draft.baselineSnapshot = feedbackSnapshot({
      ...draft.session,
      entries: draft.session.entries.map((entry) => ({ ...entry, content: `${entry.studentId}的服务器旧正文` })),
    });
    return draft;
  }

  it("clears a personal historical feedback without causing a false classmate draft conflict", () => {
    const storage = new MemoryStorage();
    const draft = classDraft();
    const untouched = classDraft("evening", "another-period");
    for (const item of [draft, untouched]) writeFeedbackDraft(scopeOf(item), item, storage);
    const savedSession = { ...draft.session, ...JSON.parse(draft.baselineSnapshot) };
    const remaining = removeFeedbackRecord([savedSession], draft.session.id, "student-1")[0];
    expect(clearStudentFeedbackDraft(scopeOf(draft), draft.session.id, "student-1", true, storage).ok).toBe(true);
    const restored = readFeedbackDrafts(scopeOf(draft), storage).drafts;
    const next = restored.find((item) => item.session.id === draft.session.id)!;
    expect(next.session.entries[0]).toEqual(emptyFeedbackEntry("student-1"));
    expect(next.session.entries[1]).toEqual(draft.session.entries[1]);
    expect(next.baselineSnapshot).toBe(feedbackSnapshot(remaining));
    expect(feedbackSnapshot(next.session)).not.toBe(next.baselineSnapshot);
    expect(restored.find((item) => item.session.id === untouched.session.id)).toEqual(untouched);
  });

  it("keeps classmates' unsaved input with an empty baseline if personal deletion removes the server session", () => {
    const storage = new MemoryStorage();
    const draft = classDraft();
    writeFeedbackDraft(scopeOf(draft), draft, storage);
    expect(clearStudentFeedbackDraft(scopeOf(draft), draft.session.id, "student-1", false, storage).ok).toBe(true);
    const restored = readFeedbackDrafts(scopeOf(draft), storage).drafts[0];
    expect(restored.baselineSnapshot).toBe("");
    expect(restored.session.entries[1]).toEqual(draft.session.entries[1]);
  });

  it("does not delete from the database if local recovery cleanup fails", async () => {
    const storage = new MemoryStorage();
    const draft = record();
    writeFeedbackDraft(scopeOf(draft), draft, storage);
    const before = new Map(storage.data);
    storage.removeItem = () => { throw new Error("blocked"); };
    const persist = vi.fn(async () => true);
    const result = await deleteFeedbackWithDraftRecovery({ scope: scopeOf(draft), sessionId: draft.session.id, persist, storage });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("反馈尚未删除") });
    expect(persist).not.toHaveBeenCalled();
    expect(storage.data).toEqual(before);
  });

  it.each([false, "throw"])("restores exact recovery bytes when database deletion fails: %s", async (failure) => {
    const storage = new MemoryStorage();
    const draft = classDraft();
    writeFeedbackDraft(scopeOf(draft), draft, storage);
    const before = new Map(storage.data);
    const result = await deleteFeedbackWithDraftRecovery({ scope: scopeOf(draft), sessionId: draft.session.id,
      studentId: "student-1", sessionRemains: true, storage,
      persist: async () => {
        expect(readFeedbackDrafts(scopeOf(draft), storage).drafts[0].session.entries[0]).toEqual(emptyFeedbackEntry("student-1"));
        if (failure === "throw") throw new Error("offline");
        return false;
      } });
    expect(result.ok).toBe(false);
    expect(storage.data).toEqual(before);
  });

  it("cleans only the target recovery record before a successful database deletion", async () => {
    const storage = new MemoryStorage();
    const target = record();
    const unrelated = record("one-to-one", "student-1", "unrelated");
    for (const draft of [target, unrelated]) writeFeedbackDraft(scopeOf(draft), draft, storage);
    const result = await deleteFeedbackWithDraftRecovery({ scope: scopeOf(target), sessionId: target.session.id, storage,
      persist: async () => {
        expect(readFeedbackDrafts(scopeOf(target), storage).drafts).toEqual([unrelated]);
        return true;
      } });
    expect(result).toEqual({ ok: true, error: null });
    expect(readFeedbackDrafts(scopeOf(target), storage).drafts).toEqual([unrelated]);
  });

  it("returns a recoverable copy if both the database request and local rollback fail", async () => {
    const storage = new MemoryStorage();
    const draft = record();
    writeFeedbackDraft(scopeOf(draft), draft, storage);
    const result = await deleteFeedbackWithDraftRecovery({ scope: scopeOf(draft), sessionId: draft.session.id, storage,
      persist: async () => { storage.setItem = () => { throw new Error("quota"); }; return false; } });
    expect(result).toMatchObject({ ok: false, recovery: draft, error: expect.stringContaining("草稿恢复失败") });
  });

  it.each(["evening", "course"] as const)("prunes only the deleted student's %s entries and baseline while preserving classmates' exact drafts", (module) => {
    const storage = new MemoryStorage();
    const first = classDraft(module);
    const second = classDraft(module, "feedback-2");
    second.selectedId = "student-2";
    const originals = [first, second].map((draft) => structuredClone(draft));
    for (const draft of [first, second]) writeFeedbackDraft(scopeOf(draft), draft, storage);
    expect(pruneStudentFeedbackDrafts(module, "class-1", "student-1", storage)).toEqual({ ok: true, error: null });
    const saved = readFeedbackDrafts(scopeOf(first), storage).drafts;
    expect(saved).toHaveLength(2);
    for (const draft of saved) {
      const before = originals.find((item) => item.session.id === draft.session.id)!;
      expect(draft.session).toEqual({ ...before.session, entries: [before.session.entries[1]] });
      expect(JSON.parse(draft.baselineSnapshot)).toEqual({
        ...JSON.parse(before.baselineSnapshot), entries: [JSON.parse(before.baselineSnapshot).entries[1]],
      });
      expect(draft.selectedId).toBe("student-2");
      expect(draft.subjectText).toBe(before.subjectText);
      expect(draft.savedAt).toBe(before.savedAt);
      expect(JSON.stringify(draft)).not.toContain("student-1");
      expect(JSON.stringify(draft)).not.toContain("被删除学生的旧反馈");
    }
    expect([first, second]).toEqual(originals);
  });

  it("cleans a deleted student's old baseline even if the current draft already omits that student", () => {
    const storage = new MemoryStorage();
    const draft = classDraft();
    draft.session.entries = [draft.session.entries[1]];
    draft.selectedId = "student-2";
    writeFeedbackDraft(scopeOf(draft), draft, storage);
    expect(pruneStudentFeedbackDrafts("evening", "class-1", "student-1", storage).ok).toBe(true);
    const saved = readFeedbackDrafts(scopeOf(draft), storage).drafts[0];
    expect(saved.session).toEqual(draft.session);
    expect(JSON.stringify(saved)).not.toContain("student-1");
  });

  it("removes lessons with no remaining students without deleting another module or class", () => {
    const storage = new MemoryStorage();
    const only = record("evening", "class-1");
    const otherClass = record("evening", "class-2");
    const otherModule = record("course", "class-1");
    for (const draft of [only, otherClass, otherModule]) writeFeedbackDraft(scopeOf(draft), draft, storage);
    expect(pruneStudentFeedbackDrafts("evening", "class-1", "student-1", storage).ok).toBe(true);
    expect(readFeedbackDrafts(scopeOf(only), storage).drafts).toEqual([]);
    expect(readFeedbackDrafts(scopeOf(otherClass), storage).drafts).toEqual([otherClass]);
    expect(readFeedbackDrafts(scopeOf(otherModule), storage).drafts).toEqual([otherModule]);
  });

  it.each(["evening", "course"] as const)("preserves unsynced %s shared content after deleting the final student", (module) => {
    for (const field of ["teachingContent", "commonTasks", "focus"] as const) {
      const storage = new MemoryStorage();
      const draft = record(module, "class-1");
      draft.session.brief![field] = "  尚未同步的班级共用内容\n请完整保留  ";
      draft.baselineSnapshot = feedbackSnapshot(draft.session);
      const original = structuredClone(draft);
      expect(writeFeedbackDraft(scopeOf(draft), draft, storage).ok).toBe(true);
      expect(pruneStudentFeedbackDrafts(module, "class-1", "student-1", storage)).toEqual({ ok: true, error: null });
      const saved = readFeedbackDrafts(scopeOf(draft), storage).drafts;
      expect(saved).toHaveLength(1);
      expect(saved[0]).toEqual({
        ...original,
        session: { ...original.session, entries: [] },
        baselineSnapshot: JSON.stringify({ ...JSON.parse(original.baselineSnapshot), entries: [] }),
        selectedId: "",
      });
      expect(saved[0].session.brief).toEqual(original.session.brief);
      expect(draft).toEqual(original);
    }
  });

  it("clears every one-on-one lesson only for the deleted target", () => {
    const storage = new MemoryStorage();
    const target = record();
    const targetSecond = record("one-to-one", "student-1", "feedback-2");
    const otherStudent = record("one-to-one", "student-2");
    const classSession = record("course", "class-1");
    for (const draft of [target, targetSecond, otherStudent, classSession]) writeFeedbackDraft(scopeOf(draft), draft, storage);
    expect(pruneStudentFeedbackDrafts("one-to-one", null, "student-1", storage).ok).toBe(true);
    expect(readFeedbackDrafts(scopeOf(target), storage).drafts).toEqual([]);
    expect(readFeedbackDrafts(scopeOf(otherStudent), storage).drafts).toEqual([otherStudent]);
    expect(readFeedbackDrafts(scopeOf(classSession), storage).drafts).toEqual([classSession]);
  });

  it.each([
    "{broken student-1 baseline", "null", '"student-1"', '{"entries":"student-1"}',
    '{"entries":[{"content":"student-1"}]}',
  ])("uses an empty conflict baseline for an unreadable baseline %# without retaining deleted-student data", (baseline) => {
    const storage = new MemoryStorage();
    const draft = classDraft();
    draft.baselineSnapshot = baseline;
    writeFeedbackDraft(scopeOf(draft), draft, storage);
    expect(pruneStudentFeedbackDrafts("evening", "class-1", "student-1", storage).ok).toBe(true);
    const saved = readFeedbackDrafts(scopeOf(draft), storage).drafts[0];
    expect(saved.baselineSnapshot).toBe("");
    expect(saved.session.entries).toEqual([draft.session.entries[1]]);
    expect(JSON.stringify(saved)).not.toContain("student-1");
  });

  it("reports corrupt records and leaves their bytes intact while cleaning the other readable drafts", () => {
    const storage = new MemoryStorage();
    const broken = classDraft("evening", "broken");
    const valid = classDraft();
    writeFeedbackDraft(scopeOf(broken), broken, storage);
    const brokenKey = storage.key(0)!;
    storage.setItem(brokenKey, "{broken original bytes");
    writeFeedbackDraft(scopeOf(valid), valid, storage);
    expect(pruneStudentFeedbackDrafts("evening", "class-1", "student-1", storage)).toMatchObject({ ok: false, error: expect.stringContaining("损坏或归属不符") });
    expect(storage.getItem(brokenKey)).toBe("{broken original bytes");
    expect(readFeedbackDrafts(scopeOf(valid), storage).drafts[0].session.entries).toEqual([valid.session.entries[1]]);
  });

  it("reports a failed write without dropping the only recoverable copy", () => {
    const storage = new MemoryStorage();
    const draft = classDraft();
    writeFeedbackDraft(scopeOf(draft), draft, storage);
    const before = new Map(storage.data);
    storage.setItem = () => { throw new DOMException("full", "QuotaExceededError"); };
    expect(pruneStudentFeedbackDrafts("evening", "class-1", "student-1", storage)).toMatchObject({ ok: false, error: expect.stringContaining("未能全部清理") });
    expect(storage.data).toEqual(before);
  });

  it("does not fall back to broad deletion for invalid targets", () => {
    const storage = new MemoryStorage();
    const draft = classDraft();
    writeFeedbackDraft(scopeOf(draft), draft, storage);
    const before = new Map(storage.data);
    expect(pruneStudentFeedbackDrafts("evening", null, "student-1", storage).ok).toBe(false);
    expect(pruneStudentFeedbackDrafts("one-to-one", "class-1", "student-1", storage).ok).toBe(false);
    expect(pruneStudentFeedbackDrafts("evening", "class-1", " ", storage).ok).toBe(false);
    expect(storage.data).toEqual(before);
  });
});
