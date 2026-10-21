import type { FeedbackSession, ModuleId } from "./types";
import { hasBriefContent, hasFeedbackContent } from "./feedbackModel";
import { emptyFeedbackEntry, parseFeedbackProvenance } from "./data";

export interface FeedbackDraftRecord {
  session: FeedbackSession;
  baselineSnapshot: string;
  subjectText: string;
  selectedId: string;
  savedAt: string;
}

export type FeedbackDraftStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;

export interface FeedbackDraftResult {
  ok: boolean;
  error: string | null;
}

const PREFIX = "nookmi:feedback-draft:";
const SUCCESS: FeedbackDraftResult = { ok: true, error: null };
const fail = (error: string): FeedbackDraftResult => ({ ok: false, error });
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is string =>
  typeof value === "string" && Boolean(value.trim());
const stringFields = (value: Record<string, unknown>, names: string[]) =>
  names.every((name) => Object.hasOwn(value, name) && typeof value[name] === "string");

/** A canonical scope prevents a lesson from being restored into another target. */
export function feedbackDraftScope(
  module: ModuleId,
  classId: string | null,
  studentId: string | null,
): string {
  const valid = module === "one-to-one"
    ? classId === null && id(studentId)
    : (module === "evening" || module === "course") && id(classId) && studentId === null;
  if (!valid) throw new Error("本机草稿的教学模块或学生、班级目标无效。");
  return JSON.stringify([module, classId, studentId]);
}

function validScope(scope: string): boolean {
  try {
    const parts: unknown = JSON.parse(scope);
    return Array.isArray(parts) && parts.length === 3 &&
      feedbackDraftScope(parts[0], parts[1], parts[2]) === scope;
  } catch {
    return false;
  }
}

function scopePrefix(scope: string): string {
  return `${PREFIX}${encodeURIComponent(scope)}:`;
}

function recordKey(scope: string, sessionId: string): string {
  return `${scopePrefix(scope)}${encodeURIComponent(sessionId)}`;
}

function validObservations(value: unknown): boolean {
  return object(value) &&
    stringFields(value, ["performance", "strengths", "difficulties", "plan", "tasks"]) &&
    object(value.subjects) && Object.values(value.subjects).every((text) => typeof text === "string");
}

function validBrief(value: unknown): boolean {
  return object(value) &&
    stringFields(value, ["periodStart", "periodEnd", "teachingContent", "commonTasks", "focus"]) &&
    Array.isArray(value.subjects) && value.subjects.every((subject) => typeof subject === "string") &&
    (value.length === "brief" || value.length === "standard");
}

function validRecord(value: unknown, scope: string): value is FeedbackDraftRecord {
  if (!object(value) || !stringFields(value, ["baselineSnapshot", "subjectText", "selectedId", "savedAt"]))
    return false;
  const savedTime = Date.parse(value.savedAt as string);
  if (!Number.isFinite(savedTime) || new Date(savedTime).toISOString() !== value.savedAt) return false;
  const session = value.session;
  if (!object(session) || !id(session.id) ||
    !stringFields(session, ["lessonAt", "createdAt", "updatedAt"]) ||
    // Keep incomplete numeric edits locally (including 0 for an empty input); validate before saving to the database.
    (session.lessonNumber !== undefined && (typeof session.lessonNumber !== "number" || !Number.isFinite(session.lessonNumber))) ||
    (session.title !== undefined && typeof session.title !== "string") ||
    !Array.isArray(session.entries) ||
    (Object.hasOwn(session, "brief") && session.brief !== undefined && !validBrief(session.brief))) return false;
  try {
    if (feedbackDraftScope(session.module as ModuleId, session.classId as string | null, session.studentId as string | null) !== scope)
      return false;
  } catch {
    return false;
  }
  const studentIds = new Set<string>();
  for (const entry of session.entries) {
    if (!object(entry) || !id(entry.studentId) || typeof entry.content !== "string" ||
      studentIds.has(entry.studentId) ||
      (Object.hasOwn(entry, "observations") && entry.observations !== undefined && !validObservations(entry.observations)) ||
      (Object.hasOwn(entry, "reviewed") && entry.reviewed !== undefined && typeof entry.reviewed !== "boolean") ||
      (Object.hasOwn(entry, "generatedFrom") && entry.generatedFrom !== undefined && typeof entry.generatedFrom !== "string") ||
      (Object.hasOwn(entry, "generationSource") && entry.generationSource !== undefined && !["ai", "manual", "outline"].includes(entry.generationSource as string)))
      return false;
    try {
      parseFeedbackProvenance(entry, session.id, entry.studentId, session.module as ModuleId);
    } catch {
      return false;
    }
    studentIds.add(entry.studentId);
  }
  if (session.module === "one-to-one" &&
    (studentIds.size !== 1 || !studentIds.has(session.studentId as string))) return false;
  return value.selectedId === "" || studentIds.has(value.selectedId as string);
}

function parseStored(raw: string, scope: string, key: string): FeedbackDraftRecord | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!object(value) || value.version !== 1 || value.scope !== scope || !validRecord(value.record, scope)) return null;
    return recordKey(scope, value.record.session.id) === key ? value.record : null;
  } catch {
    return null;
  }
}

function storageError(error: unknown, action: "读取" | "保存" | "清理"): string {
  const name = object(error) ? error.name : "";
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED")
    return "本机草稿存储空间不足，未覆盖已有草稿。请先备份重要记录并检查浏览器存储空间。";
  if (name === "SecurityError")
    return `浏览器禁止${action}本机恢复草稿，请检查本站的存储权限。`;
  return action === "清理"
    ? "本机恢复草稿未能全部清理，请检查浏览器存储设置后重试。"
    : `本机恢复草稿${action}失败，已有草稿未被主动删除。请检查浏览器存储设置。`;
}

function getStorage(adapter?: FeedbackDraftStorage): FeedbackDraftStorage | null {
  if (adapter) return adapter;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

/** Return usable records even when another record is corrupt; never erase the corrupt value. */
export function readFeedbackDrafts(
  scope: string,
  adapter?: FeedbackDraftStorage,
): { drafts: FeedbackDraftRecord[]; error: string | null } {
  const drafts: FeedbackDraftRecord[] = [];
  if (!validScope(scope)) return { drafts, error: "无法读取本机恢复草稿：教学目标无效。" };
  let corrupt = 0;
  let error: string | null = null;
  try {
    const storage = getStorage(adapter);
    if (!storage) return { drafts, error: null };
    const prefix = scopePrefix(scope);
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const raw = storage.getItem(key);
      if (raw === null) continue;
      const record = parseStored(raw, scope, key);
      if (record) drafts.push(record);
      else corrupt++;
    }
  } catch (cause) {
    error = storageError(cause, "读取");
  }
  if (corrupt) {
    error = [error, `发现 ${corrupt} 条损坏或归属不符的本机恢复草稿，原数据已保留，未自动删除。`].filter(Boolean).join(" ");
  }
  drafts.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt) || a.session.id.localeCompare(b.session.id));
  return { drafts, error };
}

/** localStorage.setItem is synchronous and atomic; quota errors leave the previous value intact. */
export function writeFeedbackDraft(
  scope: string,
  record: FeedbackDraftRecord,
  adapter?: FeedbackDraftStorage,
): FeedbackDraftResult {
  if (!validScope(scope) || !validRecord(record, scope))
    return fail("本机恢复草稿的结构或教学目标不匹配，未覆盖已有草稿。");
  try {
    const storage = getStorage(adapter);
    if (!storage) return fail("当前环境不支持本机草稿存储，尚未建立恢复副本。");
    const key = recordKey(scope, record.session.id);
    const existing = storage.getItem(key);
    if (existing !== null && !parseStored(existing, scope, key))
      return fail("这条记录已有损坏或归属不符的本机草稿，未覆盖原数据。请先保留现有输入并处理该恢复草稿。");
    storage.setItem(key, JSON.stringify({ version: 1, scope, record }));
    return SUCCESS;
  } catch (cause) {
    return fail(storageError(cause, "保存"));
  }
}

export function removeFeedbackDraft(
  scope: string,
  sessionId: string,
  adapter?: FeedbackDraftStorage,
): FeedbackDraftResult {
  if (!validScope(scope) || !id(sessionId)) return fail("无法清理本机恢复草稿：教学目标或反馈记录无效。");
  try {
    getStorage(adapter)?.removeItem(recordKey(scope, sessionId));
    return SUCCESS;
  } catch (cause) {
    return fail(storageError(cause, "清理"));
  }
}

/** Clear one student's feedback without removing the student from the class roster. */
export function clearStudentFeedbackDraft(
  scope: string, sessionId: string, studentId: string, sessionRemains: boolean,
  adapter?: FeedbackDraftStorage,
): FeedbackDraftResult {
  if (!validScope(scope) || !id(sessionId) || !id(studentId)) return fail("无法清理本次反馈：目标无效。");
  try {
    const storage = getStorage(adapter);
    if (!storage) return SUCCESS;
    const key = recordKey(scope, sessionId);
    const raw = storage.getItem(key);
    if (raw === null) return SUCCESS;
    const record = parseStored(raw, scope, key);
    if (!record) return fail("本机恢复草稿无法读取，未删除或覆盖原数据。");
    const entries = record.session.entries.map((entry) => entry.studentId === studentId ? emptyFeedbackEntry(studentId) : entry);
    const session = { ...record.session, entries };
    if (!hasFeedbackContent(session)) return removeFeedbackDraft(scope, sessionId, storage);
    let baselineSnapshot = "";
    if (sessionRemains) {
      try {
        const baseline: unknown = JSON.parse(record.baselineSnapshot);
        if (object(baseline) && Array.isArray(baseline.entries) && baseline.entries.every((entry) => object(entry) && id(entry.studentId))) {
          const normalized = baseline.entries.map((entry) => entry.studentId === studentId ? emptyFeedbackEntry(studentId) : entry);
          if (!normalized.some((entry) => entry.studentId === studentId)) normalized.push(emptyFeedbackEntry(studentId));
          baselineSnapshot = JSON.stringify({ ...baseline, entries: normalized });
        }
      } catch { /* Unknown baselines retain conflict protection. */ }
    }
    return writeFeedbackDraft(scope, { ...record, session, baselineSnapshot }, storage);
  } catch (cause) {
    return fail(storageError(cause, "清理"));
  }
}

/** Local cleanup is a prerequisite: a failed cleanup must never commit a database deletion.
 * If persistence fails, restore the exact recovery bytes without overwriting a newer local edit.
 */
export async function deleteFeedbackWithDraftRecovery(options: {
  scope: string;
  sessionId: string;
  studentId?: string;
  sessionRemains?: boolean;
  persist: () => Promise<boolean>;
  storage?: FeedbackDraftStorage;
}): Promise<FeedbackDraftResult & { recovery?: FeedbackDraftRecord }> {
  const { scope, sessionId, studentId, persist } = options;
  if (!validScope(scope) || !id(sessionId) || (studentId !== undefined && !id(studentId))) return fail("无法删除反馈：教学目标或反馈记录无效。");
  let storage: FeedbackDraftStorage | null;
  let original: string | null;
  const key = recordKey(scope, sessionId);
  try {
    storage = getStorage(options.storage);
    original = storage?.getItem(key) ?? null;
    if (original !== null && !parseStored(original, scope, key)) return fail("本机恢复草稿无法读取，数据库中的反馈尚未删除。");
  } catch (cause) {
    return fail(`反馈尚未删除。${storageError(cause, "读取")}`);
  }
  const cleaned = studentId
    ? clearStudentFeedbackDraft(scope, sessionId, studentId, options.sessionRemains ?? true, storage ?? undefined)
    : removeFeedbackDraft(scope, sessionId, storage ?? undefined);
  if (!cleaned.ok) return fail(`反馈尚未删除。${cleaned.error}`);
  let cleanedBytes: string | null = null;
  try { cleanedBytes = storage?.getItem(key) ?? null; } catch { /* Rollback below still retains the original bytes. */ }
  let saved = false;
  try { saved = await persist(); } catch { /* Restore local recovery before returning a failure. */ }
  if (saved) return SUCCESS;
  if (storage && original !== null) {
    try {
      if (storage.getItem(key) === cleanedBytes) storage.setItem(key, original);
    } catch (cause) {
      return { ...fail(`数据库删除未完成，本机草稿恢复失败。${storageError(cause, "保存")}`), recovery: parseStored(original, scope, key) ?? undefined };
    }
  }
  return { ok: false, error: null };
}

/** Use only for explicit backup restoration or target deletion; do not evict unsaved drafts. */
export function clearFeedbackDrafts(
  scope?: string,
  adapter?: FeedbackDraftStorage,
): FeedbackDraftResult {
  if (scope !== undefined && !validScope(scope)) return fail("无法清理本机恢复草稿：教学目标无效。");
  try {
    const storage = getStorage(adapter);
    if (!storage) return SUCCESS;
    const prefix = scope === undefined ? PREFIX : scopePrefix(scope);
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
    return SUCCESS;
  } catch (cause) {
    return fail(storageError(cause, "清理"));
  }
}

/** Remove only the explicitly deleted student's local recovery data. */
export function pruneStudentFeedbackDrafts(
  module: ModuleId,
  classId: string | null,
  studentId: string,
  adapter?: FeedbackDraftStorage,
  sessionId?: string,
): FeedbackDraftResult {
  if (!id(studentId)) return fail("无法清理已删除学生的本机草稿：学生目标无效。");
  if (sessionId !== undefined && !id(sessionId)) return fail("无法清理本机草稿：反馈记录无效。");
  let scope: string;
  try {
    scope = feedbackDraftScope(module, classId, module === "one-to-one" ? studentId : null);
  } catch {
    return fail("无法清理已删除学生的本机草稿：教学目标无效。");
  }
  if (module === "one-to-one") return sessionId
    ? removeFeedbackDraft(scope, sessionId, adapter) : clearFeedbackDrafts(scope, adapter);

  const result = readFeedbackDrafts(scope, adapter);
  const errors = result.error ? [result.error] : [];
  for (const record of result.drafts) {
    if (sessionId !== undefined && record.session.id !== sessionId) continue;
    const entries = record.session.entries.filter((entry) => entry.studentId !== studentId);
    if (!entries.length && !hasBriefContent(record.session.brief)) {
      const removed = removeFeedbackDraft(scope, record.session.id, adapter);
      if (removed.error) errors.push(removed.error);
      continue;
    }
    let baselineSnapshot = "";
    try {
      const baseline: unknown = JSON.parse(record.baselineSnapshot);
      if (object(baseline) && Array.isArray(baseline.entries) &&
        baseline.entries.every((entry) => object(entry) && id(entry.studentId))) {
        const baselineEntries = baseline.entries.filter((entry) => entry.studentId !== studentId);
        baselineSnapshot = baselineEntries.length === baseline.entries.length
          ? record.baselineSnapshot
          : JSON.stringify({ ...baseline, entries: baselineEntries });
      }
    } catch {
      // An unknown baseline must cause conflict checking, never authorize an overwrite.
    }
    if (entries.length === record.session.entries.length && baselineSnapshot === record.baselineSnapshot)
      continue;
    const updated = writeFeedbackDraft(scope, {
      ...record,
      session: { ...record.session, entries },
      baselineSnapshot,
      selectedId: record.selectedId === studentId ? entries[0]?.studentId ?? "" : record.selectedId,
    }, adapter);
    if (updated.error) errors.push(updated.error);
  }
  return errors.length
    ? fail(`该学生的本机草稿未能全部清理。${[...new Set(errors)].join(" ")}`)
    : SUCCESS;
}
