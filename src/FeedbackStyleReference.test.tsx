import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FeedbackStyleReference, { createStyleReferenceState, styleReferenceReducer as reduce } from "./FeedbackStyleReference";
import type { ModuleId } from "./types";

describe("personal style reference card", () => {
  it.each<[ModuleId, string]>([["one-to-one", "一对一"], ["evening", "晚辅"], ["course", "班课"]])("labels the %s module reference independently", (module, label) => {
    const html = renderToStaticMarkup(<FeedbackStyleReference module={module} value="" onSave={async () => true} />);
    expect(html).toContain("个人风格参考");
    expect(html).toContain(`${label}风格参考`);
    expect(html).toContain("未设置");
    expect(html).toContain("三个模块分别保存");
    expect(html).toContain("保存风格参考");
    expect(html).toContain("不照搬旧范文中的事实");
    expect(html).toMatch(/<textarea[^>]*maxLength="12000"/i);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
  });

  it("shows a saved reference, text count, and read-only controls when disabled", () => {
    const html = renderToStaticMarkup(<FeedbackStyleReference module="course" value="参考范文" disabled onSave={async () => true} />);
    expect(html).toContain("有参考");
    expect(html).toContain("4 / 12000 字");
    expect(html).toMatch(/<textarea[^>]*readOnly=""/i);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?保存风格参考<\/button>/);
  });

  it("renders reference text as escaped content instead of executing markup", () => {
    const html = renderToStaticMarkup(<FeedbackStyleReference module="evening" value="<script>alert(1)</script>" onSave={async () => true} />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("style reference draft protection", () => {
  it("adopts an external update only when there is no local draft", () => {
    const updated = reduce(createStyleReferenceState("原范文"), { type: "external", value: "最新范文" });
    expect(updated.draft).toBe("最新范文");
    expect(updated.savedValue).toBe("最新范文");
    expect(updated.externalValue).toBeNull();
  });

  it("preserves unsaved input when external content changes, requiring explicit replacement", () => {
    const edited = reduce(createStyleReferenceState("原范文"), { type: "edit", value: "本地正在编辑" });
    const conflicted = reduce(edited, { type: "external", value: "另一页面的新范文" });
    expect(conflicted.draft).toBe("本地正在编辑");
    expect(conflicted.savedValue).toBe("原范文");
    expect(conflicted.externalValue).toBe("另一页面的新范文");
    const replaced = reduce(conflicted, { type: "load-external" });
    expect(replaced.draft).toBe("另一页面的新范文");
    expect(replaced.savedValue).toBe(replaced.draft);
  });

  it("locks input while saving and leaves a failed submission intact for retry", () => {
    const edited = reduce(createStyleReferenceState("原范文"), { type: "edit", value: "尚未保存的范文" });
    const saving = reduce(edited, { type: "save-start", value: edited.draft });
    expect(reduce(saving, { type: "edit", value: "不应覆盖" })).toBe(saving);
    expect(reduce(saving, { type: "save-start", value: "重复提交" })).toBe(saving);
    const failed = reduce(saving, { type: "save-failure", message: "连接失败" });
    expect(failed.draft).toBe("尚未保存的范文");
    expect(failed.savedValue).toBe("原范文");
    expect(failed.saving).toBe(false);
    expect(failed.notice).toEqual({ message: "连接失败", error: true });
  });

  it("accepts the parent's saved echo without creating a false conflict", () => {
    const edited = reduce(createStyleReferenceState("旧"), { type: "edit", value: " 新 " });
    const saving = reduce(edited, { type: "save-start", value: "新" });
    const echoed = reduce(saving, { type: "external", value: "新" });
    expect(echoed.externalValue).toBeNull();
    const saved = reduce(echoed, { type: "save-success", value: "新" });
    expect(saved.draft).toBe("新");
    expect(saved.savedValue).toBe("新");
    expect(saved.saving).toBe(false);
    expect(saved.notice?.error).toBeUndefined();
  });

  it("does not erase an unrelated external update arriving during save", () => {
    const edited = reduce(createStyleReferenceState("旧"), { type: "edit", value: "我的范文" });
    const saving = reduce(edited, { type: "save-start", value: "我的范文" });
    const conflicted = reduce(saving, { type: "external", value: "另一个新版本" });
    const saved = reduce(conflicted, { type: "save-success", value: "我的范文" });
    expect(saved.draft).toBe("我的范文");
    expect(saved.externalValue).toBe("另一个新版本");
  });

  it("clears a saved reference only after saving an empty draft", () => {
    const cleared = reduce(createStyleReferenceState("已有范文"), { type: "edit", value: "" });
    expect(cleared.savedValue).toBe("已有范文");
    const saved = reduce(reduce(cleared, { type: "save-start", value: "" }), { type: "save-success", value: "" });
    expect(saved.savedValue).toBe("");
    expect(saved.notice?.message).toContain("已清除");
  });

  it("discards local edits back to the saved reference and clears a failed-save notice", () => {
    const edited = reduce(createStyleReferenceState("已保存范文"), { type: "edit", value: "未保存修改" });
    const failed = reduce(edited, { type: "save-failure", message: "连接失败" });
    expect(reduce(failed, { type: "discard" })).toEqual(createStyleReferenceState("已保存范文"));
  });

  it("discards to the latest external reference, including an externally cleared value", () => {
    const edited = reduce(createStyleReferenceState("旧范文"), { type: "edit", value: "未保存修改" });
    for (const value of ["其他页面已保存的新范文", ""]) {
      const updated = reduce(edited, { type: "external", value });
      expect(reduce(updated, { type: "discard" })).toEqual(createStyleReferenceState(value));
    }
  });

  it("cannot discard a submission while saving", () => {
    const edited = reduce(createStyleReferenceState("旧范文"), { type: "edit", value: "提交中范文" });
    const saving = reduce(edited, { type: "save-start", value: edited.draft });
    expect(reduce(saving, { type: "discard" })).toBe(saving);
  });
});
