import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import FeedbackWorkspace, { prepareFeedbackSave, withSavedTitle } from "./FeedbackWorkspace";
import FeedbackHistory, { FeedbackHistoryDetail } from "./FeedbackHistory";
import { defaultBrief, emptyObservations, feedbackSnapshot } from "./feedbackModel";
import { feedbackDraftScope, readFeedbackDrafts, writeFeedbackDraft, type FeedbackDraftStorage } from "./feedbackDrafts";
import { EMPTY_STUDENT, type FeedbackSession, type ModuleId, type Student } from "./types";

const now = "2026-10-21T10:00:00.000Z";
const student: Student = { ...EMPTY_STUDENT, id: "student-title", name: "黄亦琳", grade: "初二",
  module: "one-to-one", classId: null, createdAt: now, updatedAt: now };
const lesson = (id: string, day: string, overrides: Partial<FeedbackSession> = {}): FeedbackSession => ({
  id, module: "one-to-one", classId: null, studentId: student.id, lessonAt: `${day}T18:30`,
  brief: defaultBrief("one-to-one", [student.grade], new Date(`${day}T18:30`)),
  entries: [{ studentId: student.id, content: "能独立完成基础练习。", observations: emptyObservations(), reviewed: true }],
  createdAt: now, updatedAt: now, ...overrides,
});
const render = (sessions: FeedbackSession[] = [], target = student) => renderToStaticMarkup(<FeedbackWorkspace
  module={target.module} students={[target]} classId={target.classId}
  studentId={target.module === "one-to-one" ? target.id : null} sessions={sessions} onSave={async () => true} />);
const titleInput = (html: string) => /<input[^>]+aria-label="反馈标题"[^>]*>/.exec(html)?.[0];

function storage() {
  const values = new Map<string, string>();
  const adapter: FeedbackDraftStorage = { get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
  vi.stubGlobal("window", { localStorage: adapter });
  return values;
}
function store(session: FeedbackSession, baselineSnapshot: string) {
  const scope = feedbackDraftScope("one-to-one", null, student.id);
  const record = { session, baselineSnapshot, subjectText: "数学", selectedId: student.id, savedAt: now };
  expect(writeFeedbackDraft(scope, record).ok).toBe(true);
  return { scope, record };
}
afterEach(() => vi.unstubAllGlobals());

describe("one-to-one lesson title UI", () => {
  it("shows an editable title derived from a legacy course number without inserting it into the body", () => {
    const saved = lesson("explicit", "2026-10-21", { lessonNumber: 8 });
    const html = render([saved]);
    expect(titleInput(html)).toContain('value="亦琳第8次数学课（10.21）"');
    expect(html).toContain("亦琳第8次数学课（10.21）");
    expect(titleInput(html)).not.toContain("readOnly");
    expect(html).not.toContain('aria-label="本次课次"');
    const body = /<textarea[^>]+rows="17"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1];
    expect(body).toBe("能独立完成基础练习。");
    expect(saved.entries[0].content).toBe("能独立完成基础练习。");
  });

  it("starts a student's first course at 1 while keeping an untouched new editor unsaved", () => {
    const html = render();
    expect(titleInput(html)).toContain("亦琳第1次数学课");
    expect(html).toContain("填写后自动保存，也可以点击立即保存。");
    expect(html).not.toContain("已保存到数据库。");
  });

  it("uses a saved complete custom title without adding a separate course-number field", () => {
    const saved = lesson("custom", "2026-10-21", { title: "亦琳 · 二次函数专题课", lessonNumber: 8 });
    const html = render([saved]);
    expect(titleInput(html)).toContain('value="亦琳 · 二次函数专题课"');
    expect(html).not.toContain('aria-label="本次课次"');
    const detail = renderToStaticMarkup(<FeedbackHistoryDetail session={saved} students={[student]} onCopy={() => undefined} />);
    expect(detail).toContain("亦琳 · 二次函数专题课");
    expect(detail).not.toContain("亦琳第8次数学课");
  });

  it("suggests a legacy title without changing its saved snapshot or making it dirty", () => {
    const older = lesson("older", "2026-10-14", { updatedAt: "2026-10-14T10:00:00.000Z" });
    const latest = lesson("latest", "2026-10-21");
    const before = feedbackSnapshot(latest);
    const html = render([latest, older]);
    expect(titleInput(html)).toContain('value="亦琳第2次数学课（10.21）"');
    expect(html).toContain("亦琳第2次数学课（10.21）");
    expect(html).toContain("已保存到数据库。");
    expect(html).not.toContain("本机草稿待同步");
    expect(feedbackSnapshot(latest)).toBe(before);
    expect(latest.lessonNumber).toBeUndefined();
  });

  it("restores old pending text without a false conflict from the newly suggested title", () => {
    const values = storage();
    const remote = lesson("legacy", "2026-10-21");
    const local = structuredClone(remote);
    local.entries[0].content = "本机还在写的真实情况。";
    const { scope, record } = store(local, feedbackSnapshot(remote));
    const before = new Map(values);
    const html = render([remote]);
    expect(html).toContain("本机还在写的真实情况。");
    expect(html).toContain("已恢复上次留在本机的反馈草稿");
    expect(html).not.toContain("数据库中的这份反馈已变更");
    expect(titleInput(html)).toContain('value="亦琳第1次数学课（10.21）"');
    expect(values).toEqual(before);
    expect(readFeedbackDrafts(scope).drafts).toEqual([record]);
  });

  it.each(["", " ", "标".repeat(301)])("preserves an incomplete or overlong local title without replacing it", (title) => {
    storage();
    const remote = lesson("invalid", "2026-10-21", { lessonNumber: 8 });
    const local = { ...remote, title };
    const { scope } = store(local, feedbackSnapshot(remote));
    const html = render([remote]);
    expect(titleInput(html)).toContain(`value="${title}"`);
    expect(titleInput(html)).toContain('aria-invalid="true"');
    expect(html).toContain("请填写反馈标题（最多 300 字）。");
    expect(readFeedbackDrafts(scope).drafts[0].session.title).toBe(title);
  });

  it("recognizes a legacy draft already committed with its suggested title when the save response was lost", () => {
    storage();
    const previous = lesson("lost-response", "2026-10-21");
    const local = structuredClone(previous);
    local.entries[0].content = "已提交但本机尚未确认的新正文。";
    store(local, feedbackSnapshot(previous));
    const committed = { ...local, title: "亦琳第1次数学课（10.21）" };
    const html = render([committed]);
    expect(html).toContain("已提交但本机尚未确认的新正文。");
    expect(html).toContain("已保存到数据库。");
    expect(html).not.toContain("数据库中的这份反馈已变更");
    expect(html).not.toContain("本机草稿待同步");
    expect(titleInput(html)).toContain('value="亦琳第1次数学课（10.21）"');
  });

  it("keeps a legacy body title changed during a slow save instead of restoring the earlier derived title", () => {
    const submitted = lesson("slow-save", "2026-10-21", { title: "亦琳第8次数学课（10.21）" });
    submitted.entries[0].content = "亦琳第8次数学课（10.21）\n\n原来的正文。";
    const pending = structuredClone(submitted);
    delete pending.title;
    pending.entries[0].content = "亦琳第9次数学课（10.21）\n\n保存期间新补的正文。";
    const before = structuredClone(pending);
    const acknowledged = withSavedTitle(pending, submitted, student);
    expect(acknowledged.title).toBe("亦琳第9次数学课（10.21）");
    expect(acknowledged.entries[0].content).toBe(pending.entries[0].content);
    expect(feedbackSnapshot(acknowledged)).not.toBe(feedbackSnapshot(submitted));
    expect(pending).toEqual(before);
    expect(withSavedTitle({ ...pending, title: "自定义新标题" }, submitted, student).title).toBe("自定义新标题");
    expect(withSavedTitle({ ...pending, title: "" }, submitted, student).title).toBe("");
  });

  it.each([0, -1, 1.5, 10000])("removes obsolete invalid course number %s when saving the new title without losing any notes", (lessonNumber) => {
    const pending = lesson("old-numeric-draft", "2026-10-21", { lessonNumber, title: "亦琳第9次数学课（10.21）" });
    pending.entries[0].observations!.performance = "新标题之前已记录的课堂观察";
    const before = structuredClone(pending);
    const saved = prepareFeedbackSave(pending, [student], []);
    expect(saved).not.toHaveProperty("lessonNumber");
    expect(saved.title).toBe(pending.title);
    expect(saved.entries).toEqual(pending.entries);
    expect(saved.brief).toEqual(pending.brief);
    expect(withSavedTitle(pending, saved, student)).not.toHaveProperty("lessonNumber");
    expect(pending).toEqual(before);
  });

  it.each(["evening", "course"] as ModuleId[])("does not add a one-to-one title field to %s", (module) => {
    const html = render([], { ...student, module, classId: "class-1" });
    expect(titleInput(html)).toBeUndefined();
    expect(html).not.toContain('aria-label="反馈标题"');
  });

  it("shows the actual handwritten title in the editor, history and detail without rewriting its number or text", () => {
    const older = lesson("older", "2026-10-14");
    const saved = lesson("history", "2026-10-21");
    saved.entries[0].content = "亦琳第8次数学课（10.21）\n\n老师原来写的正文。";
    const before = structuredClone(saved);
    const html = renderToStaticMarkup(<FeedbackHistoryDetail session={saved} students={[student]} sessions={[saved, older]} onCopy={() => undefined} />);
    expect(html).toContain("反馈标题");
    expect(html).not.toContain("亦琳第2次数学课（10.21）");
    expect(html).toContain(saved.entries[0].content);
    expect(html).not.toMatch(/<textarea|<input/);
    const list = renderToStaticMarkup(<FeedbackHistory sessions={[saved, older]} students={[student]} />);
    expect(list).toContain("亦琳第8次数学课（10.21）");
    const editor = render([saved]);
    expect(titleInput(editor)).toContain('value="亦琳第8次数学课（10.21）"');
    expect(editor).toContain("亦琳第8次数学课（10.21）");
    expect(editor).not.toContain("亦琳第1次数学课（10.21）");
    expect(saved).toEqual(before);
  });
});
