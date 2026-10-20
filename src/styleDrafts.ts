import type { ModuleId } from "./types";

export interface StyleDraft {
  version: 1;
  module: ModuleId;
  draft: string;
  baseSavedValue: string;
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const styleDraftKey = (module: ModuleId) => `nookmi:style-draft:v1:${module}`;

function storageFor(storage?: DraftStorage): DraftStorage | null {
  return storage ?? (typeof window === "undefined" ? null : window.localStorage);
}

function parseDraft(raw: string, module: ModuleId): StyleDraft {
  if (raw.length > 150000) throw new Error("Invalid draft");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid draft");
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || record.module !== module ||
    typeof record.draft !== "string" || record.draft.length > 12000 ||
    typeof record.baseSavedValue !== "string" || record.baseSavedValue.length > 12000)
    throw new Error("Invalid draft");
  return { version: 1, module, draft: record.draft, baseSavedValue: record.baseSavedValue };
}

export function readStyleDraft(module: ModuleId, storage?: DraftStorage): { draft: StyleDraft | null; error: string | null } {
  try {
    const raw = storageFor(storage)?.getItem(styleDraftKey(module));
    if (!raw) return { draft: null, error: null };
    const draft = parseDraft(raw, module);
    return { draft: draft.draft === draft.baseSavedValue ? null : draft, error: null };
  } catch {
    return { draft: null, error: "无法读取本机风格草稿；原缓存未删除。请保留当前文字，检查浏览器存储后再试。" };
  }
}

/** Called directly from input events so a refresh cannot beat a deferred effect. */
export function writeStyleDraft(module: ModuleId, draft: string, baseSavedValue: string, storage?: DraftStorage): string | null {
  try {
    const record: StyleDraft = { version: 1, module, draft, baseSavedValue };
    storageFor(storage)?.setItem(styleDraftKey(module), JSON.stringify(record));
    return null;
  } catch {
    return "未能暂存风格输入，文字仍保留在当前页面。请先保存到数据库或复制留存，再刷新或离开。";
  }
}

/** Do not erase a newer draft written by another tab while a save was pending. */
export function clearStyleDraft(module: ModuleId, expected: Pick<StyleDraft, "draft" | "baseSavedValue">, storage?: DraftStorage): string | null {
  try {
    const target = storageFor(storage);
    const raw = target?.getItem(styleDraftKey(module));
    if (!raw) return null;
    const current = parseDraft(raw, module);
    if (current.draft !== expected.draft || current.baseSavedValue !== expected.baseSavedValue)
      return "另一页面已暂存新的风格草稿，该副本仍保留，未随本次操作清除。";
    target?.removeItem(styleDraftKey(module));
    return null;
  } catch {
    return "本机风格草稿未能清除，刷新后可能再次出现。请确认已保存内容，并检查浏览器存储。";
  }
}

/** Called only after a confirmed workspace restore or clear succeeds. */
export function clearAllStyleDrafts(storage?: DraftStorage): string | null {
  let target: DraftStorage | null;
  try {
    target = storageFor(storage);
  } catch {
    return "无法清除本机风格草稿，旧草稿可能再次出现。请检查浏览器存储后重试。";
  }
  let failed = false;
  for (const module of ["one-to-one", "evening", "course"] as const) {
    try {
      target?.removeItem(styleDraftKey(module));
    } catch {
      failed = true;
    }
  }
  return failed ? "部分本机风格草稿未能清除，旧草稿可能再次出现。请检查浏览器存储后重试。" : null;
}
