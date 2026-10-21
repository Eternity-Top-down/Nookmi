import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FeedbackComparisonView from "./FeedbackComparisonView";
import type { FeedbackEntry, FeedbackInputSnapshot } from "./types";

function input(): FeedbackInputSnapshot {
  return {
    module: "one-to-one", grade: "高一", lessonAt: "2026-10-22T14:00",
    brief: {
      periodStart: "2026-10-22", periodEnd: "2026-10-22", subjects: ["数学"],
      teachingContent: "等差数列", commonTasks: "", focus: "", length: "standard",
    },
    observations: { performance: "认真，复杂题需要引导", strengths: "", difficulties: "", plan: "", tasks: "复习错题", subjects: {} },
  };
}

function entry(): FeedbackEntry {
  return {
    studentId: "student-a", content: "亦琳能认真思考。建议复习错题。", reviewed: true,
    comparison: {
      source: {
        id: "draft-a", sessionId: "session-a", studentId: "student-a",
        content: "亦琳能独立思考。建议复习错题。", input: input(), createdAt: "2026-10-22T06:00:00Z", model: "test-model",
      },
      finalContent: "亦琳能认真思考。建议复习错题。", finalInput: input(), confirmedAt: "2026-10-22T06:02:00Z",
    },
  };
}

function render(value: FeedbackEntry) {
  return renderToStaticMarkup(<FeedbackComparisonView entry={value} studentName="李亦琳" />);
}

describe("confirmed feedback comparison view", () => {
  it("does not fabricate a comparison for legacy or manual-only feedback", () => {
    expect(render({ studentId: "student-a", content: "以前保存的正文", reviewed: true })).toBe("");
    const pending = entry();
    pending.aiDraft = pending.comparison!.source;
    delete pending.comparison;
    expect(render(pending)).toBe("");
  });

  it("starts collapsed and shows the two confirmed texts without adding inputs", () => {
    const html = render(entry());
    expect(html).toContain('aria-label="查看李亦琳的修改对比"');
    expect(html).toContain("AI 原稿");
    expect(html).toContain("确认采用稿");
    expect(html).toContain('<del aria-label="删去：独立">独立</del>');
    expect(html).toContain('<ins aria-label="加入：认真">认真</ins>');
    expect(html).not.toContain("上次确认采用");
    expect(html).not.toMatch(/<details[^>]*\sopen(?:[\s=>])/);
    expect(html).not.toMatch(/<(input|textarea|select|button)\b/);
    expect(html).toContain("不会自动训练模型");
  });

  it("labels a retained archive when the draft is being edited again", () => {
    const value = entry();
    value.reviewed = false;
    value.content = "尚未确认的新版本";
    const html = render(value);
    expect(html).toContain("上次确认采用");
    expect(html).toContain("重新勾选“已核对”才会更新这份对比");
    expect(html).not.toContain("尚未确认的新版本");
  });

  it("distinguishes changed facts from writing preference and preserves both inputs", () => {
    const value = entry();
    value.comparison!.finalInput.observations.performance = "能独立完成中档题";
    const html = render(value);
    expect(html).toContain("查看生成时的原始记录");
    expect(html).toContain("查看确认时更新的记录");
    expect(html).toContain("认真，复杂题需要引导");
    expect(html).toContain("能独立完成中档题");
    expect(html).toContain("不能全部当作写作偏好");
  });

  it("does not report a fact change just because subject map ordering changed", () => {
    const value = entry();
    value.comparison!.source.input.observations.subjects = { 数学: "基础扎实", 物理: "电路分析需要巩固" };
    value.comparison!.finalInput.observations.subjects = { 物理: "电路分析需要巩固", 数学: "基础扎实" };
    expect(render(value)).not.toContain("查看确认时更新的记录");
  });

  it("identifies an unchanged AI draft adopted directly", () => {
    const value = entry();
    value.content = value.comparison!.source.content;
    value.comparison!.finalContent = value.content;
    const html = render(value);
    expect(html).toContain("正文未修改，直接采用 AI 原稿");
    expect(html).not.toContain("fb-comparison-legend");
  });

  it("escapes student, source text, record and model markup", () => {
    const value = entry();
    const injected = '<script>alert("x")</script>';
    value.content = injected;
    value.comparison!.finalContent = injected;
    value.comparison!.source.content = injected;
    value.comparison!.source.model = injected;
    value.comparison!.source.input.brief.teachingContent = injected;
    const html = renderToStaticMarkup(<FeedbackComparisonView entry={value} studentName={injected} />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('onerror="');
  });
});
