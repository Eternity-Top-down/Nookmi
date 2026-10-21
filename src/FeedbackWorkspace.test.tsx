import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import FeedbackWorkspace from "./FeedbackWorkspace";
import { defaultBrief, emptyObservations, feedbackSnapshot } from "./feedbackModel";
import { feedbackDraftScope, readFeedbackDrafts, writeFeedbackDraft, type FeedbackDraftRecord, type FeedbackDraftStorage } from "./feedbackDrafts";
import { EMPTY_STUDENT, type FeedbackSession, type ModuleId, type Student } from "./types";

const now = "2026-10-21T10:00:00.000Z";

afterEach(() => vi.unstubAllGlobals());

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

describe("focused feedback workspace", () => {
  it.each(["one-to-one", "evening", "course"] as const)("keeps full AI generation and removes recommendations in %s", (module) => {
    const html = render(module);
    expect(html).not.toContain("AI 推荐记录");
    expect(html).not.toContain("feedback-suggestions");
    expect(html).toContain("AI 生成反馈");
    expect(html).toContain("立即保存");
  });
});

describe("feedback workspace local draft recovery", () => {
  function browserStorage() {
    const values = new Map<string, string>();
    const storage: FeedbackDraftStorage = {
      get length() { return values.size; },
      key: (index) => [...values.keys()][index] ?? null,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
    };
    vi.stubGlobal("window", { localStorage: storage });
    return { values, storage };
  }

  function store(session: FeedbackSession, baselineSnapshot = "", subjectText = "数学、 物理，", selectedId = session.entries[0]?.studentId ?? "") {
    const record: FeedbackDraftRecord = {
      session, baselineSnapshot, subjectText, selectedId,
      savedAt: "2026-10-21T12:00:00.000Z",
    };
    const scope = feedbackDraftScope(session.module, session.classId, session.studentId);
    expect(writeFeedbackDraft(scope, record)).toEqual({ ok: true, error: null });
    return { record, scope };
  }

  function recoveredPage(students: Student[], sessions: FeedbackSession[] = []) {
    const first = students[0];
    return renderToStaticMarkup(<FeedbackWorkspace
      module={first.module} students={students} classId={first.classId}
      studentId={first.module === "one-to-one" ? first.id : null}
      sessions={sessions} onSave={async () => true}
    />);
  }

  it("restores course content, observations, parent feedback, raw subjects and the selected class student", () => {
    const { values } = browserStorage();
    const { student, session: remote } = fixture("course");
    const second = { ...student, id: "student-2", name: "第二位同学" };
    remote.entries.push({ studentId: second.id, content: "", observations: emptyObservations() });
    const local = structuredClone(remote);
    local.brief!.teachingContent = "本机尚未同步的二次函数课程内容";
    local.entries[0].content = "第一位的本机正文";
    local.entries[1].content = "第二位尚未同步的家长反馈正文";
    local.entries[1].observations!.performance = "第二位独立画出抛物线";
    const { scope, record } = store(local, feedbackSnapshot(remote), "数学、 物理，", second.id);
    const before = new Map(values);
    const html = recoveredPage([student, second], [remote]);
    expect(html).toContain("本机尚未同步的二次函数课程内容");
    expect(html).toContain("第二位独立画出抛物线");
    expect(labeledTextareas(html).find(({ label }) => label === "第二位同学的家长反馈正文")?.value).toBe("第二位尚未同步的家长反馈正文");
    expect(html).toContain("第一位的本机正文");
    expect(html).toContain('value="数学、 物理，"');
    expect(html).toContain('aria-label="第二位同学的反馈工作区"');
    expect(html).not.toContain('aria-label="选择反馈学生"');
    expect(html).toContain("已恢复上次留在本机的反馈草稿");
    expect(html).not.toContain("数据库中的这份反馈已变更");
    expect(readFeedbackDrafts(scope).drafts).toEqual([record]);
    expect(values).toEqual(before);
  });

  it("recovers a never-saved lesson with an empty server baseline without reporting a version conflict", () => {
    browserStorage();
    const { student, session } = fixture();
    session.lessonAt = "";
    session.brief!.periodStart = "";
    session.brief!.periodEnd = "";
    session.brief!.teachingContent = "日期还没填完的课程内容";
    session.entries[0].content = "刷新前刚写的反馈";
    store(session, "", "数学，");
    const html = recoveredPage([student]);
    expect(html).toContain("日期还没填完的课程内容");
    expect(html).toContain("刷新前刚写的反馈");
    expect(html).toContain('value="数学，"');
    expect(html).toContain("上课时间");
    expect(html).toContain("已恢复上次留在本机的反馈草稿");
    expect(html).not.toContain("数据库中的这份反馈已变更");
    expect(html).not.toContain("保留这份文字，另存为新反馈");
  });

  it.each(["one-to-one", "evening", "course"] as const)("recognizes an already-committed %s draft when the save acknowledgment was lost", (module) => {
    browserStorage();
    const { student, session: previous } = fixture(module);
    previous.entries[0].content = "服务器之前的正文";
    const committed = structuredClone(previous);
    committed.entries[0].content = "已写入数据库但响应尚未确认的正文";
    committed.brief!.teachingContent = "本次共同学习内容";
    const local = structuredClone(committed);
    local.updatedAt = "2026-10-21T11:00:00.000Z";
    store(local, feedbackSnapshot(previous), "数学、 物理，");
    const html = recoveredPage([student], [committed]);
    expect(html).toContain("已写入数据库但响应尚未确认的正文");
    expect(html).toContain("已保存到数据库。");
    expect(html).toContain('value="数学、 物理，"');
    expect(html).not.toContain("数据库中的这份反馈已变更");
    expect(html).not.toContain("采用数据库版本");
    expect(html).not.toContain("保留这份文字，另存为新反馈");
  });

  it("reports a real database conflict while keeping the local text visible and stored", () => {
    const { values } = browserStorage();
    const { student, session: previous } = fixture();
    previous.entries[0].content = "最初数据库正文";
    const local = structuredClone(previous);
    local.entries[0].content = "本机正在写的正文，不可覆盖";
    local.entries[0].observations!.difficulties = "本机新记录的困难";
    const remote = structuredClone(previous);
    remote.entries[0].content = "另一页面更新到数据库的正文";
    const { scope, record } = store(local, feedbackSnapshot(previous));
    const before = new Map(values);
    const html = recoveredPage([student], [remote]);
    expect(html).toContain("数据库中的这份反馈已变更");
    expect(html).toContain("保留这份文字，另存为新反馈");
    expect(html).toContain("采用数据库版本");
    expect(html).toContain("本机正在写的正文，不可覆盖");
    expect(html).toContain("本机新记录的困难");
    expect(html).not.toContain("另一页面更新到数据库的正文");
    expect(readFeedbackDrafts(scope).drafts).toEqual([record]);
    expect(values).toEqual(before);
  });

  it("never restores another one-on-one student's draft, even with the same feedback ID", () => {
    browserStorage();
    const { student, session } = fixture();
    session.entries[0].content = "第一位学生的私有草稿";
    store(session);
    const second = { ...student, id: "student-2", name: "另一位学生" };
    const other = { ...structuredClone(session), studentId: second.id,
      entries: [{ studentId: second.id, content: "另一位学生自己的草稿", observations: emptyObservations() }] };
    store(other);
    const html = recoveredPage([second]);
    expect(html).toContain("另一位学生自己的草稿");
    expect(html).not.toContain("第一位学生的私有草稿");
    expect(recoveredPage([student])).not.toContain("另一位学生自己的草稿");
  });

  it("isolates evening and course drafts sharing class and feedback IDs, and isolates different classes", () => {
    browserStorage();
    const evening = fixture("evening");
    const course = fixture("course");
    evening.session.entries[0].content = "晚辅模块专属周反馈";
    course.session.entries[0].content = "班课模块专属月反馈";
    store(evening.session);
    store(course.session);
    const another = { ...course.student, classId: "class-2" };
    const anotherSession = { ...structuredClone(course.session), classId: another.classId };
    anotherSession.entries[0].content = "另一个班级自己的月反馈";
    store(anotherSession);
    const eveningHtml = recoveredPage([evening.student]);
    expect(eveningHtml).toContain("晚辅模块专属周反馈");
    expect(eveningHtml).not.toContain("班课模块专属月反馈");
    const courseHtml = recoveredPage([course.student]);
    expect(courseHtml).toContain("班课模块专属月反馈");
    expect(courseHtml).not.toContain("晚辅模块专属周反馈");
    expect(courseHtml).not.toContain("另一个班级自己的月反馈");
    const anotherHtml = recoveredPage([another]);
    expect(anotherHtml).toContain("另一个班级自己的月反馈");
    expect(anotherHtml).not.toContain("班课模块专属月反馈");
  });

  it("falls back to an existing roster member when the formerly selected student was removed", () => {
    browserStorage();
    const { student, session } = fixture("course");
    session.entries[0].content = "保留学生的当前正文";
    session.entries.push({ studentId: "removed-student", content: "已移除学生的旧正文", observations: emptyObservations() });
    const { scope, record } = store(session, "", "数学、", "removed-student");
    const html = recoveredPage([student]);
    expect(html).toContain("测试学生的家长反馈正文");
    expect(html).toContain("保留学生的当前正文");
    expect(html).not.toContain("已移除学生的旧正文");
    expect(html).not.toContain("结构或教学目标不匹配");
    expect(readFeedbackDrafts(scope).drafts).toEqual([record]);
  });

  it("does not call an untouched new editor already saved to the database", () => {
    browserStorage();
    const { student } = fixture();
    const html = recoveredPage([student]);
    expect(html).toContain("填写后自动保存，也可以点击立即保存。");
    expect(html).not.toContain("已保存到数据库。");
  });
});

describe("simple student situation input", () => {
  function optionalDetails(html: string) {
    return [...html.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/g)]
      .find((match) => match[2].includes("补充细节（选填）"));
  }

  it.each(["one-to-one", "evening", "course"] as const)("offers a main observation field and starts empty optional details collapsed in %s", (module) => {
    const html = render(module);
    const label = module === "one-to-one" ? "课堂状态与掌握情况" : "学生情况";
    const main = labeledTextareas(html).find((field) => field.label.startsWith(label));
    expect(main?.attributes).toContain('rows="4"');
    expect(main?.label).toContain("亮点、困难和建议可以写在一起");
    expect(main?.label).toContain("能独立做什么、卡在哪里、提示后怎样");
    expect(main?.attributes).not.toMatch(/\brequired\b/);
    const details = optionalDetails(html);
    expect(details).toBeDefined();
    expect(details?.[1]).not.toMatch(/\bopen(?:=|\s|$)/);
    expect(labeledTextareas(details![2]).map((field) => field.label)).toEqual(["值得肯定", "需要关注", "下一步建议"]);
    expect(details?.[2]).not.toContain("课后任务");
    expect(details?.[2]).not.toContain("个人任务");
  });

  it.each(["strengths", "difficulties", "plan"] as const)("opens optional details when saved %s content exists without changing the original record", (field) => {
    const { session } = fixture();
    session.entries[0].observations![field] = "已经记录的细节，不应隐藏";
    const before = structuredClone(session);
    const html = render("one-to-one", session);
    const details = optionalDetails(html);
    expect(details?.[1]).toContain('open=""');
    expect(details?.[2]).toContain("已经记录的细节，不应隐藏");
    expect(session).toEqual(before);
  });

  it("keeps generation available when only an optional facts field is filled", () => {
    const { session } = fixture();
    session.entries[0].observations!.strengths = "能解释每一步运算的依据";
    const html = render("one-to-one", session);
    const button = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
      .find((match) => match[2].includes("AI 生成反馈"));
    expect(button).toBeDefined();
    expect(button?.[1]).not.toContain("disabled");
    expect(labeledTextareas(html).find((field) => field.label.startsWith("课堂状态与掌握情况"))?.value).toBe("");
  });

  it.each([
    ["one-to-one", "数列基础题能独立做", "讲解后能自己订正"],
    ["evening", "作业按时完成", "物理电路图经提示能分析"],
    ["course", "集合基础题能独立做", "稍作提示后能继续推导"],
  ] as const)("guides short factual notes in %s without requiring more fields or personal references", (module, subject, response) => {
    const { session, student } = fixture(module);
    session.entries[0].observations!.performance = "能独立做基础题，变式需要提示";
    const html = renderToStaticMarkup(<FeedbackWorkspace
      module={module} students={[student]} classId={student.classId}
      studentId={module === "one-to-one" ? student.id : null}
      sessions={[session]} onSave={async () => true} onSaveStyle={async () => true}
    />);
    const main = labeledTextareas(html).find((field) => field.label.startsWith(module === "one-to-one" ? "课堂状态与掌握情况" : "学生情况"));
    expect(main?.attributes).toContain(subject);
    expect(main?.attributes).toContain(response);
    expect(html).toContain("已用内置范文");
    expect(html).toMatch(/<option value="standard" selected="">按范文完整展开<\/option>/);
    expect(html).toContain('<option value="brief">简短，抓住重点</option>');
    const button = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
      .find((match) => match[2].includes("AI 生成反馈"));
    expect(button?.[1]).not.toContain("disabled");
  });

  it("keeps one-to-one homework and evening subject records outside the optional details", () => {
    const { session } = fixture("one-to-one", "", "完成已布置的复习任务");
    const oneToOneHtml = render("one-to-one", session);
    expect(taskInputs(oneToOneHtml)[0].value).toBe("完成已布置的复习任务");
    expect(optionalDetails(oneToOneHtml)?.[2]).not.toContain("完成已布置的复习任务");
    const evening = fixture("evening");
    evening.session.entries[0].observations!.subjects = { 数学: "能独立列式", 物理: "受力方向需要提醒" };
    const eveningHtml = render("evening", evening.session);
    expect(labeledTextareas(eveningHtml).filter((field) => ["数学", "物理"].includes(field.label)).map((field) => field.value))
      .toEqual(["能独立列式", "受力方向需要提醒"]);
    expect(optionalDetails(eveningHtml)?.[2]).not.toContain("受力方向需要提醒");
  });
});
