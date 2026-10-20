import { describe, expect, it } from "vitest";
import { clearAllStyleDrafts, clearStyleDraft, readStyleDraft, styleDraftKey, writeStyleDraft } from "./styleDrafts";
import type { ModuleId } from "./types";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("local style draft recovery", () => {
  it("writes immediately and restores the exact text and database baseline for each module", () => {
    const storage = memoryStorage();
    const modules: ModuleId[] = ["one-to-one", "evening", "course"];
    for (const module of modules)
      expect(writeStyleDraft(module, ` ${module}\n新范文 `, `${module}旧范文`, storage)).toBeNull();
    for (const module of modules) {
      expect(readStyleDraft(module, storage)).toEqual({
        draft: { version: 1, module, draft: ` ${module}\n新范文 `, baseSavedValue: `${module}旧范文` },
        error: null,
      });
    }
  });

  it("restores an intentional empty draft for a previously saved reference", () => {
    const storage = memoryStorage();
    writeStyleDraft("course", "", "原范文", storage);
    expect(readStyleDraft("course", storage).draft?.draft).toBe("");
  });

  it("does not offer a draft with no change from its saved baseline", () => {
    const storage = memoryStorage();
    writeStyleDraft("course", "原范文", "原范文", storage);
    expect(readStyleDraft("course", storage)).toEqual({ draft: null, error: null });
  });

  it("clears only the submitted or explicitly discarded module draft", () => {
    const storage = memoryStorage();
    writeStyleDraft("course", "修改", "原范文", storage);
    writeStyleDraft("evening", "晚辅修改", "晚辅原范文", storage);
    expect(clearStyleDraft("course", { draft: "修改", baseSavedValue: "原范文" }, storage)).toBeNull();
    expect(readStyleDraft("course", storage).draft).toBeNull();
    expect(readStyleDraft("evening", storage).draft?.draft).toBe("晚辅修改");
  });

  it("does not clear another tab's newer draft after an older save completes", () => {
    const storage = memoryStorage();
    writeStyleDraft("course", "请求中草稿", "原范文", storage);
    writeStyleDraft("course", "另一页面新草稿", "原范文", storage);
    expect(clearStyleDraft("course", { draft: "请求中草稿", baseSavedValue: "原范文" }, storage)).toContain("另一页面");
    expect(readStyleDraft("course", storage).draft?.draft).toBe("另一页面新草稿");
  });

  it("clears exactly the three module keys after workspace replacement", () => {
    const storage = memoryStorage();
    for (const module of ["one-to-one", "evening", "course"] as const)
      writeStyleDraft(module, "未保存范文", "原范文", storage);
    storage.setItem("nookmi:session-draft:other", "其他草稿");
    storage.setItem("unrelated", "其他应用数据");
    expect(clearAllStyleDrafts(storage)).toBeNull();
    for (const module of ["one-to-one", "evening", "course"] as const)
      expect(storage.getItem(styleDraftKey(module))).toBeNull();
    expect(storage.getItem("nookmi:session-draft:other")).toBe("其他草稿");
    expect(storage.getItem("unrelated")).toBe("其他应用数据");
  });

  it("reports partial cleanup failure and still attempts the other modules", () => {
    const storage = memoryStorage();
    for (const module of ["one-to-one", "evening", "course"] as const)
      writeStyleDraft(module, "未保存范文", "原范文", storage);
    const partiallyBlocked = { ...storage, removeItem: (key: string) => {
      if (key === styleDraftKey("evening")) throw new Error("私密错误");
      storage.removeItem(key);
    } };
    const error = clearAllStyleDrafts(partiallyBlocked);
    expect(error).toContain("部分本机风格草稿未能清除");
    expect(error).not.toContain("私密错误");
    expect(readStyleDraft("one-to-one", storage).draft).toBeNull();
    expect(readStyleDraft("course", storage).draft).toBeNull();
    expect(readStyleDraft("evening", storage).draft?.draft).toBe("未保存范文");
  });

  it("keeps recoverable cached text when a later write fails", () => {
    const storage = memoryStorage();
    writeStyleDraft("evening", "之前已暂存", "原范文", storage);
    const blocked = { ...storage, setItem: () => { throw new Error("quota"); } };
    expect(writeStyleDraft("evening", "当前仍在内存的输入", "原范文", blocked)).toContain("当前页面");
    expect(readStyleDraft("evening", storage).draft?.draft).toBe("之前已暂存");
    expect(clearStyleDraft("evening", { draft: "之前已暂存", baseSavedValue: "原范文" }, storage)).toBeNull();
  });

  it("reports unavailable storage and unsuccessful clearing without exposing submitted text", () => {
    const storage = memoryStorage();
    const blocked = { ...storage, getItem: () => { throw new Error("私密输入"); } };
    const error = readStyleDraft("course", blocked).error;
    expect(error).toContain("无法读取");
    expect(error).not.toContain("私密输入");
    writeStyleDraft("course", "私密输入", "旧", storage);
    const cannotClear = { ...storage, removeItem: () => { throw new Error("私密输入"); } };
    expect(clearStyleDraft("course", { draft: "私密输入", baseSavedValue: "旧" }, cannotClear)).toContain("未能清除");
    expect(readStyleDraft("course", storage).draft?.draft).toBe("私密输入");
  });

  it.each([
    "not-json",
    JSON.stringify({ version: 2, module: "course", draft: "新", baseSavedValue: "旧" }),
    JSON.stringify({ version: 1, module: "evening", draft: "新", baseSavedValue: "旧" }),
    JSON.stringify({ version: 1, module: "course", draft: 42, baseSavedValue: "旧" }),
    JSON.stringify({ version: 1, module: "course", draft: "字".repeat(12001), baseSavedValue: "旧" }),
  ])("leaves an invalid cache in place and reports failed recovery", (raw) => {
    const storage = memoryStorage();
    storage.setItem(styleDraftKey("course"), raw);
    expect(readStyleDraft("course", storage).error).toContain("原缓存未删除");
    expect(storage.getItem(styleDraftKey("course"))).toBe(raw);
  });
});
