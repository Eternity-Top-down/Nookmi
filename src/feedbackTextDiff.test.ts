import { describe, expect, it } from "vitest";
import { diffFeedbackText } from "./feedbackTextDiff";

function verify(before: string, after: string) {
  const result = diffFeedbackText(before, after);
  expect(result.parts.filter((part) => part.kind !== "add").map((part) => part.text).join("")).toBe(before);
  expect(result.parts.filter((part) => part.kind !== "remove").map((part) => part.text).join("")).toBe(after);
  expect(result.parts.every((part) => part.text.length > 0)).toBe(true);
  expect(result.parts.every((part, index) => index === 0 || result.parts[index - 1].kind !== part.kind)).toBe(true);
  return result;
}

describe("feedback text comparison", () => {
  it("does not mark an unchanged adoption as edited", () => {
    const result = verify("亦琳独立完成基础题。\n继续巩固。", "亦琳独立完成基础题。\n继续巩固。");
    expect(result.parts).toEqual([{ kind: "equal", text: "亦琳独立完成基础题。\n继续巩固。" }]);
    expect(result.additions).toBe(0);
    expect(result.removals).toBe(0);
  });

  it.each([["", ""], ["", "新增整段"], ["删除整段", ""], ["\n ", " \n"]])("retains empty/whitespace input exactly: %s -> %s", (before, after) => {
    verify(before, after);
  });

  it("localizes separate edits inside Chinese sentences", () => {
    const result = verify("亦琳课堂专注，能独立完成基础题。建议复习公式，完成三题。", "亦琳课堂较专注，能独立完成基础题。建议复习条件，完成两题。");
    expect(result.parts).toContainEqual({ kind: "equal", text: "专注，能独立完成基础题。建议复习" });
    expect(result.parts.filter((part) => part.kind === "add").map((part) => part.text).join("")).toBe("较条件两");
    expect(result.parts.filter((part) => part.kind === "remove").map((part) => part.text).join("")).toBe("公式三");
  });

  it("keeps Unicode code points whole when highlighting", () => {
    const result = verify("📖 学习𠮷字与函数。", "✨ 学习𠮷字与数列。");
    expect(result.parts).toContainEqual({ kind: "remove", text: "📖" });
    expect(result.parts).toContainEqual({ kind: "add", text: "✨" });
    expect(result.parts.some((part) => part.kind === "equal" && part.text.includes("𠮷"))).toBe(true);
    expect(result.removals).toBe(2);
    expect(result.additions).toBe(2);
  });

  it("aligns unchanged paragraphs and refines several changed sentences in a long feedback", () => {
    const paragraphs = Array.from({ length: 55 }, (_, i) => `第${i + 1}条：能够认真思考，并尝试利用已知条件解题。\n`);
    const before = paragraphs.join("");
    const changed = [...paragraphs];
    changed[4] = changed[4].replace("认真", "独立");
    changed[35] = changed[35].replace("尝试", "逐步");
    const result = verify(before, changed.join(""));
    expect(result.approximate).toBe(false);
    expect(result.additions).toBe(4);
    expect(result.removals).toBe(4);
  });

  it("preserves a long unchanged prefix and suffix around a tiny edit", () => {
    const prefix = "认真思考".repeat(1000);
    const suffix = "复习巩固".repeat(1000);
    const result = verify(`${prefix}独立完成${suffix}`, `${prefix}引导后完成${suffix}`);
    expect(result.approximate).toBe(false);
    expect(result.parts[0]).toEqual({ kind: "equal", text: prefix });
    expect(result.additions).toBe(3);
    expect(result.removals).toBe(2);
  });

  it("bounds work for a completely rewritten maximum-length document", () => {
    const result = verify("甲".repeat(10000), "乙".repeat(10000));
    expect(result.approximate).toBe(true);
    expect(result.parts).toHaveLength(2);
    expect(result.additions).toBe(10000);
    expect(result.removals).toBe(10000);
  });

  it("bounds many tiny changed sentences without dropping newlines", () => {
    const result = verify("甲。\n".repeat(3300), "乙！\n".repeat(3300));
    expect(result.approximate).toBe(true);
    expect(result.parts.length).toBeLessThan(20);
  });

  it("reconstructs deterministic mixed inputs across many short edits", () => {
    let seed = 67;
    const pick = () => { seed = (seed * 16807) % 2147483647; return seed; };
    const alphabet = Array.from("数学薄弱。\n📖𠮷 ");
    for (let sample = 0; sample < 80; sample++) {
      const before = Array.from({ length: pick() % 100 }, () => alphabet[pick() % alphabet.length]).join("");
      const after = Array.from({ length: pick() % 100 }, () => alphabet[pick() % alphabet.length]).join("");
      verify(before, after);
    }
  });
});
