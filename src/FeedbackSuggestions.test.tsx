import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import FeedbackSuggestions, {
  createSuggestionsState,
  suggestionInputKey,
  suggestionsReducer as reduce,
} from "./FeedbackSuggestions";
import type { GenerateRequest } from "./api";
import { defaultBrief, emptyObservations } from "./feedbackModel";

function request(): GenerateRequest {
  return {
    module: "one-to-one", grade: "初二",
    brief: defaultBrief("one-to-one", ["初二"], new Date(2026, 9, 21)),
    observations: emptyObservations(),
  };
}
const candidates = [{ field: "performance" as const, text: "能独立列出方程，移项时需要检查符号。" }, { field: "plan" as const, text: "建议先复查变号步骤。" }];

describe("AI observation suggestions presentation", () => {
  it("offers no assumed facts and requires an actual personal observation", () => {
    const onApply = vi.fn();
    const html = renderToStaticMarkup(<FeedbackSuggestions input={request()} onApply={onApply} />);
    expect(html).toContain("AI 推荐记录");
    expect(html).toContain("不推断实际表现");
    expect(html).toContain("点击后才加入记录");
    expect(html).toContain("先写一条真实观察");
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).not.toContain("feedback-suggestions-list");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("does not treat plans, tasks, or shared teaching content as personal facts", () => {
    const input = request();
    input.brief.teachingContent = "一元一次方程";
    input.observations.plan = "下次检查变号";
    input.observations.tasks = "完成第 3 题";
    const html = renderToStaticMarkup(<FeedbackSuggestions input={input} onApply={() => {}} />);
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain("仅有后续计划或任务还不能生成推荐");
  });

  it.each(["performance", "strengths", "difficulties", "subjects"] as const)("allows recommendations based on the %s observation", (field) => {
    const input = request();
    if (field === "subjects") input.observations.subjects = { "数学": "能独立列出方程" };
    else input.observations[field] = "能独立列出方程";
    const html = renderToStaticMarkup(<FeedbackSuggestions input={input} onApply={() => {}} />);
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
    expect(html).not.toContain("先写一条真实观察");
  });

  it("honors a parent operation lock even when facts are present", () => {
    const input = request();
    input.observations.performance = "能独立列出方程";
    expect(renderToStaticMarkup(<FeedbackSuggestions input={input} disabled onApply={() => {}} />)).toMatch(/<button[^>]*disabled=""/);
  });

  it("locates a cleared lesson time, then enables recommendations immediately after correction", () => {
    const input = request();
    input.observations.performance = "能独立列出方程";
    const before = structuredClone(input);
    const invalid = renderToStaticMarkup(<FeedbackSuggestions input={input} lessonAt="" onApply={() => {}} />);
    expect(invalid).toContain("请填写有效的上课时间");
    expect(invalid).toMatch(/<button[^>]*disabled=""/);
    const corrected = renderToStaticMarkup(<FeedbackSuggestions input={input} lessonAt="2026-10-21T18:30" onApply={() => {}} />);
    expect(corrected).not.toContain("请填写有效的上课时间");
    expect(corrected).not.toMatch(/<button[^>]*disabled=""/);
    expect(input).toEqual(before);
  });

  it("shows all specific period, subject, and personal-record issues before a request can be sent", () => {
    const input = request();
    input.module = "evening";
    input.brief.periodStart = "2026-10-25";
    input.brief.periodEnd = "2026-10-19";
    input.brief.subjects = Array.from({ length: 11 }, (_, i) => `科目${i}`);
    input.observations.difficulties = "字".repeat(2001);
    const html = renderToStaticMarkup(<FeedbackSuggestions input={input} onApply={() => {}} />);
    expect(html).toContain("周期结束日期不能早于周期开始日期");
    expect(html).toContain("科目最多填写 10 个");
    expect(html).toContain("需要关注不能超过 2000 字");
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(html).not.toContain("输入格式不正确");
  });
});

describe("suggestion results remain tied to the current request", () => {
  it("discards candidates and late responses when a teacher edits the input", () => {
    const loading = reduce(createSuggestionsState("old"), { type: "start", key: "old", requestId: 1 });
    const changed = reduce(loading, { type: "input", key: "new" });
    expect(changed.busy).toBe(false);
    expect(reduce(changed, { type: "success", key: "old", requestId: 1, suggestions: candidates })).toBe(changed);
    const complete = reduce(loading, { type: "success", key: "old", requestId: 1, suggestions: candidates });
    expect(reduce(complete, { type: "input", key: "new" }).suggestions).toEqual([]);
  });

  it("ignores an earlier response even when the teacher changes away and back to identical input", () => {
    const first = reduce(createSuggestionsState("same"), { type: "start", key: "same", requestId: 1 });
    const next = reduce(reduce(first, { type: "input", key: "changed" }), { type: "start", key: "same", requestId: 2 });
    expect(reduce(next, { type: "success", key: "same", requestId: 1, suggestions: candidates })).toBe(next);
    expect(reduce(next, { type: "failure", key: "same", requestId: 1, message: "旧请求错误" })).toBe(next);
    expect(reduce(next, { type: "success", key: "same", requestId: 2, suggestions: candidates }).suggestions).toEqual(candidates);
  });

  it("does not show a late result after explicit cancellation", () => {
    const loading = reduce(createSuggestionsState("same"), { type: "start", key: "same", requestId: 5 });
    const canceled = reduce(loading, { type: "clear", key: "same", notice: "已取消" });
    expect(canceled.busy).toBe(false);
    expect(reduce(canceled, { type: "success", key: "same", requestId: 5, suggestions: candidates })).toBe(canceled);
  });

  it("clears all candidates after one selection and never reapplies a completed response", () => {
    const loading = reduce(createSuggestionsState("same"), { type: "start", key: "same", requestId: 5 });
    const ready = reduce(loading, { type: "success", key: "same", requestId: 5, suggestions: candidates });
    const applied = reduce(ready, { type: "apply", key: "same", requestId: 5 });
    expect(applied.suggestions).toEqual([]);
    expect(reduce(applied, { type: "apply", key: "same", requestId: 5 })).toBe(applied);
    expect(reduce(applied, { type: "success", key: "same", requestId: 5, suggestions: candidates })).toBe(applied);
  });

  it("exposes an actionable failure without changing any teacher input", () => {
    const input = request();
    input.observations.performance = "尚未整理的真实观察";
    const before = structuredClone(input);
    const key = suggestionInputKey(input);
    const loading = reduce(createSuggestionsState(key), { type: "start", key, requestId: 1 });
    const failed = reduce(loading, { type: "failure", key, requestId: 1, message: "请先配置 AI 服务" });
    expect(failed.error).toBe("请先配置 AI 服务");
    expect(failed.busy).toBe(false);
    expect(input).toEqual(before);
    expect(reduce(failed, { type: "start", key, requestId: 2 }).error).toBe("");
  });

  it("explains an empty recommendation list without inventing fallback facts", () => {
    const loading = reduce(createSuggestionsState("same"), { type: "start", key: "same", requestId: 1 });
    const ready = reduce(loading, { type: "success", key: "same", requestId: 1, suggestions: [] });
    expect(ready.suggestions).toEqual([]);
    expect(ready.notice).toContain("没有新的可选建议");
    expect(ready.error).toBe("");
  });
});

describe("suggestion input identity", () => {
  it("invalidates a request when lesson hours change without changing the day", () => {
    const input = request();
    expect(suggestionInputKey(input, "2026-10-21T18:30")).not.toBe(suggestionInputKey(input, "2026-10-21T19:30"));
  });
  it.each([
    ["module", (value: GenerateRequest) => { value.module = "evening"; }],
    ["grade", (value: GenerateRequest) => { value.grade = "初三"; }],
    ["style", (value: GenerateRequest) => { value.styleReference = "新的个人风格"; }],
    ["periodStart", (value: GenerateRequest) => { value.brief.periodStart = "2026-10-22"; }],
    ["periodEnd", (value: GenerateRequest) => { value.brief.periodEnd = "2026-10-23"; }],
    ["subjects", (value: GenerateRequest) => { value.brief.subjects = ["物理"]; }],
    ["teachingContent", (value: GenerateRequest) => { value.brief.teachingContent = "新内容"; }],
    ["commonTasks", (value: GenerateRequest) => { value.brief.commonTasks = "新任务"; }],
    ["focus", (value: GenerateRequest) => { value.brief.focus = "新关注点"; }],
    ["length", (value: GenerateRequest) => { value.brief.length = "brief"; }],
    ...(["performance", "strengths", "difficulties", "plan", "tasks"] as const).map((field) => [field, (value: GenerateRequest) => { value.observations[field] = "教师的新输入"; }] as const),
    ["subject observation", (value: GenerateRequest) => { value.observations.subjects = { 数学: "新观察" }; }],
  ] as const)("invalidates old candidates when %s changes", (_, change) => {
    const input = request();
    const oldKey = suggestionInputKey(input);
    change(input);
    expect(suggestionInputKey(input)).not.toBe(oldKey);
  });

  it("does not invalidate because equivalent subject maps have a different insertion order", () => {
    const input = request();
    input.observations.subjects = { 数学: "方程", 物理: "受力" };
    const equivalent = structuredClone(input);
    equivalent.observations.subjects = { 物理: "受力", 数学: "方程" };
    equivalent.styleReference = "";
    expect(suggestionInputKey(equivalent)).toBe(suggestionInputKey(input));
  });
});
