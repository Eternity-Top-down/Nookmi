import { useMemo } from "react";
import { ChevronRight, GitCompare } from "lucide-react";
import { diffFeedbackText, type FeedbackDiffPart } from "./feedbackTextDiff";
import type { FeedbackEntry, FeedbackInputSnapshot } from "./types";
import "./feedbackComparison.css";

const moduleNames = { "one-to-one": "一对一", evening: "晚辅", course: "班课" };

function inputKey(input: FeedbackInputSnapshot): string {
  const { brief, observations } = input;
  return JSON.stringify([
    input.module, input.grade, input.lessonAt,
    brief.periodStart, brief.periodEnd, brief.subjects, brief.teachingContent, brief.commonTasks, brief.focus, brief.length,
    observations.performance, observations.strengths, observations.difficulties, observations.plan, observations.tasks,
    Object.entries(observations.subjects).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}

function Snapshot({ input }: { input: FeedbackInputSnapshot }) {
  const { brief, observations } = input;
  const fields: [string, string][] = [
    ["教学 / 学习内容", brief.teachingContent],
    [input.module === "one-to-one" ? "课后任务" : "全班安排 / 共性提醒", brief.commonTasks],
    ["反馈表达重点", brief.focus],
    ["本次情况", observations.performance], ["值得肯定", observations.strengths],
    ["需要关注", observations.difficulties], ["下一步建议", observations.plan], ["课后任务", observations.tasks],
    ...Object.entries(observations.subjects).map(([subject, value]): [string, string] => [`${subject}情况`, value]),
  ];
  return <div className="fb-comparison-input">
    <p className="fb-comparison-meta">{moduleNames[input.module]} · {input.grade || "未填写年级"} · {brief.subjects.join("、") || "未填写科目"} · {brief.length === "brief" ? "简短反馈" : "完整反馈"}</p>
    <p className="fb-comparison-meta">{input.module === "one-to-one" ? `上课时间：${input.lessonAt.replace("T", " ")}` : `反馈周期：${brief.periodStart} 至 ${brief.periodEnd}`}</p>
    <dl>{fields.filter(([, value]) => value.trim()).map(([label, value], index) => <div key={`${label}-${index}`}>
      <dt>{label}</dt><dd>{value}</dd>
    </div>)}</dl>
  </div>;
}

function ComparedText({ parts, side }: { parts: FeedbackDiffPart[]; side: "before" | "after" }) {
  return <div className="fb-comparison-text">{parts.map((part, index) => {
    if ((side === "before" && part.kind === "add") || (side === "after" && part.kind === "remove")) return null;
    if (part.kind === "remove") return <del key={index} aria-label={`删去：${part.text}`}>{part.text}</del>;
    if (part.kind === "add") return <ins key={index} aria-label={`加入：${part.text}`}>{part.text}</ins>;
    return <span key={index}>{part.text}</span>;
  })}</div>;
}

export default function FeedbackComparisonView({ entry, studentName }: { entry: FeedbackEntry; studentName: string }) {
  const comparison = entry.comparison;
  const diff = useMemo(() => comparison ? diffFeedbackText(comparison.source.content, comparison.finalContent) : null, [comparison]);
  if (!comparison || !diff) return null;
  const priorConfirmation = !entry.reviewed || entry.content !== comparison.finalContent;
  const inputChanged = inputKey(comparison.source.input) !== inputKey(comparison.finalInput);
  const unchanged = diff.additions === 0 && diff.removals === 0;
  return <details className="fb-comparison">
    <summary aria-label={`查看${studentName}的修改对比`}><span><GitCompare size={16} />查看修改对比{priorConfirmation && <small>上次确认采用</small>}</span><ChevronRight size={15} /></summary>
    <div className="fb-comparison-content">
      <p className="fb-comparison-meta">确认于 {new Date(comparison.confirmedAt).toLocaleString("zh-CN", { hour12: false })} · {unchanged ? "正文未修改，直接采用 AI 原稿" : `新增 ${diff.additions} 个字符，删去 ${diff.removals} 个字符`}</p>
      {priorConfirmation && <p className="fb-comparison-notice">这里保留的是上次确认采用的版本。当前草稿修改后，重新勾选“已核对”才会更新这份对比。</p>}
      {!unchanged && <p className="fb-comparison-legend"><del>删去的内容</del><ins>加入的内容</ins>{diff.approximate && <span>较大的改写按整段标记。</span>}</p>}
      <div className="fb-comparison-columns">
        <section aria-label={`${studentName}的 AI 原稿`}><h4>AI 原稿</h4><ComparedText parts={diff.parts} side="before" /></section>
        <section aria-label={`${studentName}的确认采用稿`}><h4>确认采用稿</h4><ComparedText parts={diff.parts} side="after" /></section>
      </div>
      <details className="fb-comparison-records"><summary>查看生成时的原始记录<ChevronRight size={14} /></summary><Snapshot input={comparison.source.input} /></details>
      {inputChanged && <details className="fb-comparison-records"><summary>查看确认时更新的记录<ChevronRight size={14} /></summary><p className="fb-comparison-notice">这次也调整了课程或学生记录，正文的变化可能来自事实补充，不能全部当作写作偏好。</p><Snapshot input={comparison.finalInput} /></details>}
      <p className="fb-comparison-footnote">AI 原稿是当时显示给你、用于修改的那一版。这里只保留一次确认采用的对比，供后续分析，不会自动训练模型。{comparison.source.model && <span>生成模型：{comparison.source.model}。</span>}</p>
    </div>
  </details>;
}
