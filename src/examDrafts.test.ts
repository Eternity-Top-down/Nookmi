import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  clearExamDrafts, editorFingerprint, examToEditor, pruneStudentExamDrafts,
  readExamDrafts, removeExamDraft, validateExamEditor, writeExamDraft,
  type ExamDraft, type ExamEditor,
} from "./examDrafts";
import type { Exam } from "./types";
import { EMPTY_STUDENT, type Student } from "./types";
import { useExamWorkspace } from "./useExamWorkspace";

const now = "2026-10-21T08:00:00.000Z";
const fixture = (id = "exam-1", classId = "class-1"): Exam => ({
  id, classId, name: "第一次月考", date: "2026-10-21", subject: "数学", defaultMaxScore: 150,
  createdAt: now, updatedAt: now,
  entries: [
    { studentId: "s1", school: "一中", score: 0, maxScore: 150, status: "recorded" },
    { studentId: "s2", school: "二中", score: 82.5, maxScore: 100, status: "recorded" },
    { studentId: "s3", school: "二中", score: null, maxScore: 100, status: "absent" },
    { studentId: "s4", school: "", score: null, maxScore: 100, status: "pending" },
  ],
});
const draft = (id = "exam-1", classId = "class-1"): ExamDraft => ({ editor: examToEditor(fixture(id, classId)), baseUpdatedAt: now });

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => { values.clear(); },
  };
}
let storage: ReturnType<typeof memoryStorage>;
beforeEach(() => { storage = memoryStorage(); vi.stubGlobal("localStorage", storage); });
afterEach(() => vi.unstubAllGlobals());

describe("exam draft isolation and recovery", () => {
  it("restores exact text, score strings and saved baseline separately for each exam and class", () => {
    const values = [draft(), draft("exam-2"), draft("exam-1", "class-2")];
    values[0].editor.name = " 正在编辑\n月考 ";
    values[0].editor.entries[0].score = "00.50";
    values[1].baseUpdatedAt = null;
    values.forEach((value) => expect(writeExamDraft(value)).toBeNull());
    expect(readExamDrafts("class-1")).toEqual({ drafts: values.slice(0, 2), error: null });
    expect(readExamDrafts("class-2")).toEqual({ drafts: [values[2]], error: null });
  });

  it("encodes delimiters so similar class and exam IDs cannot share a key", () => {
    const values = [draft("a:b", "班级"), draft("b", "班级:a"), draft("a%3Ab", "班级")];
    values.forEach(writeExamDraft);
    expect(storage.length).toBe(3);
    expect(readExamDrafts("班级").drafts.map((value) => value.editor.id)).toEqual(["a:b", "a%3Ab"]);
    expect(readExamDrafts("班级:a").drafts[0].editor.id).toBe("b");
  });

  it("clears only the selected exam, class or exam namespace", () => {
    writeExamDraft(draft()); writeExamDraft(draft("exam-2")); writeExamDraft(draft("exam-1", "class-2"));
    storage.setItem("nookmi:session-draft:feedback", "feedback");
    storage.setItem("unrelated", "other data");
    expect(removeExamDraft("class-1", "exam-1")).toBeNull();
    expect(readExamDrafts("class-1").drafts.map((value) => value.editor.id)).toEqual(["exam-2"]);
    expect(clearExamDrafts("class-1")).toBeNull();
    expect(readExamDrafts("class-1").drafts).toEqual([]);
    expect(readExamDrafts("class-2").drafts).toHaveLength(1);
    expect(clearExamDrafts()).toBeNull();
    expect(storage.length).toBe(2);
    expect(storage.getItem("unrelated")).toBe("other data");
    expect(storage.getItem("nookmi:session-draft:feedback")).toBe("feedback");
  });

  it("removes a deleted student's rows from every draft in that class without changing other students", () => {
    writeExamDraft(draft()); writeExamDraft(draft("exam-2")); writeExamDraft(draft("exam-1", "class-2"));
    expect(pruneStudentExamDrafts("class-1", "s2")).toBeNull();
    for (const value of readExamDrafts("class-1").drafts) {
      expect(value.editor.entries.map((row) => row.studentId)).toEqual(["s1", "s3", "s4"]);
      expect(value.editor.entries[0].score).toBe("0");
      expect(value.baseUpdatedAt).toBe(now);
    }
    expect(readExamDrafts("class-2").drafts[0].editor.entries).toHaveLength(4);
  });

  it("reports unreadable drafts without silently deleting their recovery bytes", () => {
    const key = "nookmi:exam-draft:v1:class-1:bad";
    storage.setItem(key, "not json");
    expect(readExamDrafts("class-1").error).toContain("读取失败");
    expect(storage.getItem(key)).toBe("not json");
    expect(pruneStudentExamDrafts("class-1", "s1")).toContain("读取失败");
  });

  it.each([
    { editor: { ...draft().editor, classId: "class-other" }, baseUpdatedAt: now },
    { editor: { ...draft().editor, id: "different-id" }, baseUpdatedAt: now },
    { editor: { ...draft().editor, entries: [{ ...draft().editor.entries[0], score: 80 }] }, baseUpdatedAt: now },
    { editor: { ...draft().editor, entries: [{ ...draft().editor.entries[0], status: "unknown" }] }, baseUpdatedAt: now },
    { editor: draft().editor, baseUpdatedAt: 42 },
  ])("refuses malformed or mismatched cached records", (value) => {
    const key = "nookmi:exam-draft:v1:class-1:exam-1";
    storage.setItem(key, JSON.stringify(value));
    expect(readExamDrafts("class-1")).toMatchObject({ drafts: [], error: expect.any(String) });
    expect(storage.getItem(key)).toBe(JSON.stringify(value));
  });

  it("preserves the last recovery copy when quota blocks a later write", () => {
    const old = draft();
    writeExamDraft(old);
    const latest = structuredClone(old); latest.editor.entries[0].score = "95";
    vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("private details"); });
    expect(writeExamDraft(latest)).toContain("暂存失败");
    expect(readExamDrafts("class-1").drafts[0]).toEqual(old);
  });

  it("reports denied storage without leaking the underlying exception", () => {
    vi.stubGlobal("localStorage", { get length() { throw new Error("private details"); },
      setItem() { throw new Error("private details"); }, removeItem() { throw new Error("private details"); } });
    for (const error of [readExamDrafts("class-1").error, writeExamDraft(draft()), removeExamDraft("class-1", "exam-1"), clearExamDrafts()]) {
      expect(error).toBeTruthy();
      expect(error).not.toContain("private details");
    }
  });
});

describe("exam editor validation", () => {
  it("roundtrips zero, decimals, absences and missing scores without turning blanks into zero", () => {
    const value = fixture();
    const editor = examToEditor(value);
    expect(editor.entries.map((row) => row.score)).toEqual(["0", "82.5", "", ""]);
    expect(validateExamEditor(editor)).toEqual({ exam: value, errors: {} });
  });

  it("does not mutate editor strings and trims labels on submission only", () => {
    const editor = examToEditor(fixture());
    editor.name = "  第一次月考  "; editor.subject = " 数学 "; editor.entries[0].school = " 一中 ";
    const before = structuredClone(editor);
    const saved = validateExamEditor(editor).exam!;
    expect(saved.name).toBe("第一次月考"); expect(saved.subject).toBe("数学"); expect(saved.entries[0].school).toBe("一中");
    expect(editor).toEqual(before);
  });

  it.each([".5", "80.", "0.25", " 82.5 "])("accepts ordinary decimal input %s consistently with paste", (score) => {
    const editor = examToEditor(fixture()); editor.entries[0].score = score;
    const result = validateExamEditor(editor);
    expect(result.errors).toEqual({});
    expect(result.exam?.entries[0].score).toBe(Number(score));
  });

  it.each(["", " ", "NaN", "Infinity", "-1", "151", "80%", "1e2"])("rejects an invalid recorded score %s with a row-specific error", (score) => {
    const editor = examToEditor(fixture()); editor.entries[0].score = score;
    const result = validateExamEditor(editor);
    expect(result.exam).toBeNull(); expect(result.errors['student:s1']).toContain("成绩须");
  });

  it.each(["", "0", "-1", "1001", "Infinity", "1e2"])("rejects invalid default and per-student maximums %s", (max) => {
    const editor = examToEditor(fixture()); editor.defaultMaxScore = max; editor.entries[0].maxScore = max;
    const result = validateExamEditor(editor);
    expect(result.exam).toBeNull(); expect(result.errors.defaultMaxScore).toBeTruthy(); expect(result.errors['student:s1']).toBeTruthy();
  });

  it.each(["2026-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-10-0", "2026/10/21", "1899-12-31", "2101-01-01", ""])("rejects impossible or out-of-range dates %s", (date) => {
    const editor = examToEditor(fixture()); editor.date = date;
    expect(validateExamEditor(editor)).toMatchObject({ exam: null, errors: { date: expect.any(String) } });
  });

  it.each(["1900-01-01", "2024-02-29", "2100-12-31"])("accepts valid boundary and leap dates %s", (date) => {
    const editor = examToEditor(fixture()); editor.date = date;
    expect(validateExamEditor(editor).exam?.date).toBe(date);
  });

  it("finds metadata and school errors without losing the underlying draft", () => {
    const editor = examToEditor(fixture());
    editor.name = " "; editor.subject = "科".repeat(51); editor.entries[0].school = "校".repeat(121);
    expect(validateExamEditor(editor)).toMatchObject({ exam: null, errors: { name: expect.any(String), subject: expect.any(String), 'student:s1': expect.any(String) } });
    expect(writeExamDraft({ editor, baseUpdatedAt: now })).toBeNull();
    expect(readExamDrafts("class-1").drafts[0].editor).toEqual(editor);
  });

  it("fingerprints all user input while ignoring only the save timestamp", () => {
    const editor = examToEditor(fixture());
    expect(editorFingerprint(editor)).toBe(editorFingerprint({ ...editor, updatedAt: "2026-10-22T10:00:00.000Z" }));
    const changed: ExamEditor = { ...editor, entries: editor.entries.map((row, index) => index ? row : { ...row, score: "100" }) };
    expect(editorFingerprint(editor)).not.toBe(editorFingerprint(changed));
  });

  it.each(["name", "date", "subject", "defaultMaxScore", "__proto__", "constructor", "toString"])("keeps row validation for special student ID %s separate from metadata", (studentId) => {
    const editor = examToEditor(fixture());
    editor.name = " "; editor.date = "2026-02-30"; editor.subject = " "; editor.defaultMaxScore = "0";
    editor.entries[0].studentId = studentId; editor.entries[0].score = "9999";
    const result = validateExamEditor(editor);
    expect(result.exam).toBeNull();
    expect(result.errors[`student:${studentId}`]).toContain("成绩须");
    expect(result.errors.name).toContain("考试名称");
    expect(result.errors.date).toContain("考试日期");
    expect(result.errors.subject).toContain("科目");
    expect(result.errors.defaultMaxScore).toContain("满分须");
    expect(Object.getPrototypeOf(result.errors)).toBeNull();
    expect(Object.keys(result.errors)).toHaveLength(5);
  });
});

// Capturing the actual hook callbacks lets these tests exercise asynchronous save
// snapshots without a simulated React state machine. Browser effects/timers are
// deliberately not claimed by these server-rendered callback tests.
function workspace(onSave: (exam: Exam, automatic?: boolean) => Promise<boolean>, exams = [fixture()], blocked = false) {
  let result: ReturnType<typeof useExamWorkspace> | undefined;
  const members: Student[] = fixture().entries.map((entry) => ({
    ...EMPTY_STUDENT, id: entry.studentId, name: entry.studentId, school: entry.school, module: "course", classId: "class-1",
    createdAt: now, updatedAt: now,
  }));
  function Capture() {
    result = useExamWorkspace("class-1", members, exams, onSave, blocked, () => undefined);
    return null;
  }
  renderToStaticMarkup(createElement(Capture));
  return result!;
}

describe("exam save callback protection", () => {
  it("keeps a different tab's newer draft when an older unchanged save completes", async () => {
    let finish: ((ok: boolean) => void) | undefined;
    const onSave = vi.fn((_exam: Exam) => new Promise<boolean>((resolve) => { finish = resolve; }));
    const work = workspace(onSave);
    const submitted = structuredClone(work.draft!.editor); submitted.entries[0].score = "70";
    work.change(submitted);
    const pending = work.save();
    const otherTab = readExamDrafts("class-1").drafts[0];
    otherTab.editor.entries[0].score = "99.5";
    otherTab.editor.updatedAt = "2026-10-22T08:00:00.000Z";
    writeExamDraft(otherTab);
    finish!(true);
    expect(await pending).toBe(true);
    expect(readExamDrafts("class-1").drafts).toEqual([otherTab]);
  });

  it("keeps the old recovery copy if saving a recovered new exam hits the storage quota", () => {
    const original = draft(); original.baseUpdatedAt = "2026-10-20T08:00:00.000Z";
    writeExamDraft(original);
    const work = workspace(async () => true);
    const remove = vi.spyOn(storage, "removeItem");
    vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    work.recoverAsNew();
    expect(remove).not.toHaveBeenCalled();
    expect(readExamDrafts("class-1").drafts).toEqual([original]);
  });

  it("keeps input made while an older save is pending and advances its database baseline", async () => {
    let finish: ((ok: boolean) => void) | undefined;
    const onSave = vi.fn((_exam: Exam) => new Promise<boolean>((resolve) => { finish = resolve; }));
    const work = workspace(onSave);
    const submitted = structuredClone(work.draft!.editor);
    submitted.entries[0].score = "70";
    work.change(submitted);
    const pending = work.save();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].entries[0].score).toBe(70);
    const newer = structuredClone(submitted); newer.entries[0].score = "93.5";
    work.change(newer);
    finish!(true);
    expect(await pending).toBe(true);
    const recovered = readExamDrafts("class-1").drafts[0];
    expect(recovered.editor.entries[0].score).toBe("93.5");
    expect(recovered.baseUpdatedAt).toBe(onSave.mock.calls[0][0].updatedAt);
  });

  it("does not start a duplicate submission while the current write is pending", async () => {
    let finish: ((ok: boolean) => void) | undefined;
    const onSave = vi.fn((_exam: Exam) => new Promise<boolean>((resolve) => { finish = resolve; }));
    const work = workspace(onSave);
    work.change(work.draft!.editor);
    const pending = work.save();
    expect(await work.save()).toBe(false);
    expect(onSave).toHaveBeenCalledTimes(1);
    finish!(true); await pending;
  });

  it("keeps the exact local draft when the database rejects a save", async () => {
    const onSave = vi.fn(async () => false);
    const work = workspace(onSave);
    const next = structuredClone(work.draft!.editor); next.entries[0].score = "91";
    work.change(next);
    expect(await work.save()).toBe(false);
    expect(readExamDrafts("class-1").drafts[0]).toMatchObject({ baseUpdatedAt: now, editor: { entries: [expect.objectContaining({ score: "91" }), expect.anything(), expect.anything(), expect.anything()] } });
  });

  it("rejects stale recovered drafts and an externally blocked workspace before writing", async () => {
    const cached = draft(); cached.baseUpdatedAt = "2026-10-20T08:00:00.000Z";
    writeExamDraft(cached);
    const onSave = vi.fn(async () => true);
    const stale = workspace(onSave);
    expect(stale.conflict).toBe(true);
    expect(await stale.save()).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
    expect(readExamDrafts("class-1").drafts[0]).toEqual(cached);
    clearExamDrafts();
    const blocked = workspace(onSave, [fixture()], true);
    expect(await blocked.save()).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("blocks a recovered draft whose previously saved exam was deleted", async () => {
    writeExamDraft(draft());
    const onSave = vi.fn(async () => true);
    const work = workspace(onSave, []);
    expect(work.conflict).toBe(true);
    expect(await work.save()).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
    expect(readExamDrafts("class-1").drafts).toHaveLength(1);
  });

  it("never submits an invalid edit and clears only an unchanged successfully saved exam draft", async () => {
    const onSave = vi.fn(async () => true);
    const other = draft("other-exam"); other.editor.updatedAt = "2026-10-20T08:00:00.000Z";
    writeExamDraft(other); writeExamDraft(draft());
    const work = workspace(onSave, [fixture(), fixture("other-exam")]);
    const invalid = structuredClone(work.draft!.editor); invalid.entries[0].score = "9999";
    work.change(invalid);
    expect(await work.save()).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
    invalid.entries[0].score = "88";
    work.change(invalid);
    expect(await work.save()).toBe(true);
    expect(readExamDrafts("class-1").drafts).toEqual([other]);
  });
});
