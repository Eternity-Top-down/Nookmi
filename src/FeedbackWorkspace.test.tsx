import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FeedbackWorkspace from "./FeedbackWorkspace";
import { defaultBrief, emptyObservations } from "./feedbackModel";
import { EMPTY_STUDENT, type FeedbackSession, type ModuleId, type Student } from "./types";

const now = "2026-10-21T10:00:00.000Z";

function fixture(module: ModuleId = "one-to-one", commonTasks = "", tasks = "") {
  const student: Student = {
    ...EMPTY_STUDENT,
    id: "student-1", name: "测试学生", grade: "初二", module,
    classId: module === "one-to-one" ? null : "class-1",
    createdAt: now, updatedAt: now,
  };
  const session: FeedbackSession = {
    id: "feedback-1", module, classId: student.classId,
    studentId: module === "one-to-one" ? student.id : null,
    lessonAt: "2026-10-21T18:30", createdAt: now, updatedAt: now,
    brief: { ...defaultBrief(module, [student.grade], new Date(2026, 9, 21)), commonTasks },
    entries: [{ studentId: student.id, content: "", observations: { ...emptyObservations(), tasks } }],
  };
  return { student, session };
}

function render(module: ModuleId, session?: FeedbackSession): string {
  const { student } = fixture(module);
  return renderToStaticMarkup(
    <FeedbackWorkspace
      module={module} students={[student]} classId={student.classId}
      studentId={module === "one-to-one" ? student.id : null}
      sessions={session ? [session] : []} onSave={async () => true}
    />,
  );
}

function labeledTextareas(html: string) {
  return [...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)].flatMap((match) => {
    const textarea = /<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/.exec(match[1]);
    if (!textarea) return [];
    return [{
      label: match[1].slice(0, textarea.index).replace(/<[^>]*>/g, "").trim(),
      attributes: textarea[1], value: textarea[2],
    }];
  });
}

const taskInputs = (html: string) => labeledTextareas(html).filter(({ label }) =>
  /课后任务|个人任务|全班安排/.test(label),
);

describe("feedback workspace task fields", () => {
  it("shows exactly one lesson task input and individual-course wording for one-to-one", () => {
    const html = render("one-to-one");
    const visibleText = html.replace(/<[^>]*>/g, "");
    expect(taskInputs(html)).toHaveLength(1);
    expect(taskInputs(html)[0].label).toContain("课后任务");
    expect(taskInputs(html)[0].attributes).toContain('maxLength="8000"');
    expect(visibleText).toContain("本次课程信息");
    expect(visibleText).toContain("课堂状态与掌握情况");
    expect(visibleText).not.toMatch(/共同课后|个人任务|仅这位|共用/);
  });

  it.each([
    ["完成讲义第3页", "订正两道错题", "完成讲义第3页\n订正两道错题"],
    ["完成讲义第3页", "", "完成讲义第3页"],
    ["", "订正两道错题", "订正两道错题"],
    ["完成讲义第3页", "完成讲义第3页", "完成讲义第3页"],
  ])("loads old task fields into the only visible input without mutating the saved session", (common, individual, expected) => {
    const { session } = fixture("one-to-one", common, individual);
    const original = structuredClone(session);
    const fields = taskInputs(render("one-to-one", session));
    expect(fields).toHaveLength(1);
    expect(fields[0].value).toBe(expected);
    expect(session).toEqual(original);
  });

  it("keeps the entire former maximum task pair visible in an editable-sized input", () => {
    const common = "讲".repeat(5000);
    const individual = "题".repeat(2000);
    const { session } = fixture("one-to-one", common, individual);
    const [field] = taskInputs(render("one-to-one", session));
    expect(field.value).toBe(`${common}\n${individual}`);
    expect(field.value).toHaveLength(7001);
    expect(field.attributes).toContain('maxLength="8000"');
  });

  it("shows the old common task even when the saved entry has no observations", () => {
    const { session } = fixture("one-to-one", "请完成课堂练习");
    delete session.entries[0].observations;
    expect(taskInputs(render("one-to-one", session))[0].value).toBe("请完成课堂练习");
    expect(session.entries[0]).not.toHaveProperty("observations");
  });

  it("still opens pre-brief legacy feedback without inventing a second task field", () => {
    const { session } = fixture("one-to-one");
    delete session.brief;
    delete session.entries[0].observations;
    session.entries[0].content = "旧版已写好的反馈正文";
    const html = render("one-to-one", session);
    expect(taskInputs(html)).toHaveLength(1);
    expect(taskInputs(html)[0].value).toBe("");
    expect(html).toContain("旧版已写好的反馈正文");
  });

  it.each(["evening", "course"] as const)("preserves separate shared and individual task inputs for %s", (module) => {
    const { session } = fixture(module, "全班统一完成练习", "这位同学补做订正");
    const fields = taskInputs(render(module, session));
    expect(fields).toHaveLength(2);
    expect(fields.map(({ value }) => value)).toEqual(["全班统一完成练习", "这位同学补做订正"]);
    expect(fields[0].label).toContain(module === "evening" ? "共同课后任务" : "全班安排");
    expect(fields[1].label).toBe("个人任务");
  });
});

describe("feedback workspace style integration", () => {
  it.each<[ModuleId, string]>([["one-to-one", "一对一"], ["evening", "晚辅"], ["course", "班课"]])("passes the %s module and its reference to the style card without replacing saved feedback", (module, label) => {
    const { student, session } = fixture(module);
    session.entries[0].content = "已经写好的反馈正文";
    const original = structuredClone(session);
    const reference = `${label}专属表达范文`;
    const html = renderToStaticMarkup(
      <FeedbackWorkspace
        module={module} students={[student]} classId={student.classId}
        studentId={module === "one-to-one" ? student.id : null}
        sessions={[session]} onSave={async () => true}
        styleReference={reference} onSaveStyle={async () => true}
      />,
    );
    const fields = labeledTextareas(html).filter(({ label: fieldLabel }) => fieldLabel.endsWith("风格参考"));
    expect(fields).toHaveLength(1);
    expect(fields[0].label).toBe(`${label}风格参考`);
    expect(fields[0].value).toBe(reference);
    expect(html).toContain("已经写好的反馈正文");
    expect(session).toEqual(original);
  });

  it("keeps legacy callers without a style reference working without adding an unusable editor", () => {
    const html = render("one-to-one");
    expect(html).not.toContain("保存风格参考");
    expect(html).toContain("AI 生成反馈");
  });
});

describe("feedback workspace recommendation validation", () => {
  it("passes the complete lesson time to recommendation validation while preserving every record", () => {
    const { session } = fixture("one-to-one");
    session.lessonAt = "";
    session.entries[0].observations!.performance = "教师尚未整理的真实观察";
    session.entries[0].content = "已经写好的反馈正文";
    const original = structuredClone(session);
    const html = render("one-to-one", session);
    const recommendation = /<section class="feedback-suggestions"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
    expect(recommendation).toContain("请填写有效的上课时间");
    expect(recommendation).toMatch(/<button[^>]*disabled=""/);
    expect(html).toContain("教师尚未整理的真实观察");
    expect(html).toContain("已经写好的反馈正文");
    expect(session).toEqual(original);
  });

  it.each(["evening", "course"] as const)("identifies a cleared period end for %s without requiring teaching content", (module) => {
    const { session } = fixture(module);
    session.entries[0].observations!.performance = "能独立完成练习";
    session.brief!.periodEnd = "";
    const invalid = render(module, session);
    expect(invalid).toContain("请填写有效的周期结束日期");
    session.brief!.periodEnd = session.brief!.periodStart;
    const corrected = render(module, session);
    const recommendation = /<section class="feedback-suggestions"[\s\S]*?<\/section>/.exec(corrected)?.[0] ?? "";
    expect(recommendation).not.toMatch(/<button[^>]*disabled=""/);
    expect(recommendation).not.toContain("请填写有效");
  });
});
