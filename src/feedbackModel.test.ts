import { describe, expect, it } from "vitest";
import {
  canApplyGeneration,
  defaultBrief,
  defaultSubjects,
  emptyObservations,
  entryIsStale,
  feedbackSnapshot,
  feedbackInputErrors,
  formatGenerationReviewWarnings,
  generationSignature,
  hasFeedbackContent,
  hasObservations,
  hasPersonalFacts,
  mergeLessonTasks,
  normalizeOneToOneTasks,
  outlineFeedback,
  prepareGeneratedFeedback,
  sortFeedbackByRecentEdit,
} from "./feedbackModel";
import type { FeedbackSession, ModuleId } from "./types";

describe("generation review notices", () => {
  it("groups the same warning once for all affected students", () => {
    const warnings = [
      { name: "测试甲", warning: " 自动复核未完成，请核对初稿。 " },
      { name: "测试乙", warning: "自动复核未完成，请核对初稿。" },
      { name: "测试甲", warning: "自动复核未完成，请核对初稿。" },
    ];
    const before = structuredClone(warnings);
    expect(formatGenerationReviewWarnings(warnings)).toBe("测试甲、测试乙：自动复核未完成，请核对初稿。");
    expect(warnings).toEqual(before);
  });

  it("keeps different notices associated with the correct names", () => {
    expect(formatGenerationReviewWarnings([
      { name: "测试甲", warning: "请核对初稿。" },
      { name: "测试乙", warning: "复核超时，初稿已保留。" },
    ])).toBe("测试甲：请核对初稿。 测试乙：复核超时，初稿已保留。");
  });

  it("does not warn for responses that completed their automatic review", () => {
    expect(formatGenerationReviewWarnings([{ name: "测试甲" }, { name: "测试乙", warning: " \n " }])).toBe("");
    expect(formatGenerationReviewWarnings([])).toBe("");
  });
});

describe("local generated student references", () => {
  it("replaces every anonymous reference with the exact target name independently", () => {
    const response = "  【学生】能独立完成基础题。建议【学生】复盘变形过程。\n";
    expect(prepareGeneratedFeedback(response, "测试甲")).toBe("测试甲能独立完成基础题。建议测试甲复盘变形过程。");
    expect(prepareGeneratedFeedback(response, "测试乙")).toBe("测试乙能独立完成基础题。建议测试乙复盘变形过程。");
    expect(response).toContain("【学生】");
  });

  it("inserts punctuation and replacement tokens literally", () => {
    expect(prepareGeneratedFeedback("建议【学生】认真复盘，【学生】可以尝试重新推导。", "测试$&$`同学"))
      .toBe("建议测试$&$`同学认真复盘，测试$&$`同学可以尝试重新推导。");
  });

  it("keeps ordinary wording intact and only recognizes the exact reserved placeholder", () => {
    expect(prepareGeneratedFeedback("孩子基础题能做。[学生]不是占位符。", "测试同学"))
      .toBe("孩子基础题能做。[学生]不是占位符。");
  });

  it.each([undefined, null, 17, "", " \n ", "字".repeat(10001)])("rejects invalid output before it can replace a saved draft", (value) => {
    expect(() => prepareGeneratedFeedback(value, "测试同学")).toThrow("AI 返回内容为空或过长");
  });

  it("checks the final length after restoring the name", () => {
    const response = `${"字".repeat(9996)}【学生】`;
    expect(prepareGeneratedFeedback(response, "测试同学")).toHaveLength(10000);
    expect(() => prepareGeneratedFeedback(response, "比较长的测试姓名")).toThrow("替换称呼后过长");
  });
});

function fixture(): FeedbackSession {
  return {
    id: "feedback-1",
    module: "evening",
    classId: "class-1",
    studentId: null,
    lessonAt: "2026-10-19T00:00",
    brief: defaultBrief("evening", ["初二"], new Date(2026, 9, 21, 12)),
    entries: [
      {
        studentId: "student-1",
        content: "",
        observations: emptyObservations(),
      },
    ],
    createdAt: "2026-10-21T10:00:00.000Z",
    updatedAt: "2026-10-21T10:00:00.000Z",
  };
}

describe("shared feedback input validation", () => {
  function input(module: ModuleId = "one-to-one") {
    return {
      module, grade: "初二", styleReference: "",
      brief: defaultBrief(module, ["初二"], new Date(2026, 9, 21)),
      observations: { ...emptyObservations(), performance: "能独立列出方程" },
    };
  }

  it("allows empty optional course fields and never mutates the teacher's notes", () => {
    const value = input();
    value.brief.subjects = [];
    const before = structuredClone(value);
    expect(feedbackInputErrors(value, { lessonAt: "2026-10-21T18:30", requirePersonalFacts: true })).toEqual([]);
    expect(value).toEqual(before);
  });

  it.each(["", "2026-10-21", "2026-02-29T18:30", "1899-12-31T18:30", "2101-01-01T00:00", "2026-10-21T24:00"])("locates an invalid lesson time %s", (lessonAt) => {
    expect(feedbackInputErrors(input(), { lessonAt })[0]).toContain("上课时间");
  });

  it.each(["evening", "course"] as const)("identifies the invalid side of a %s period and rejects reverse ranges", (module) => {
    const value = input(module);
    const start = value.brief.periodStart;
    value.brief.periodStart = "";
    expect(feedbackInputErrors(value)).toEqual([expect.stringContaining("周期开始")]);
    value.brief.periodStart = start;
    value.brief.periodEnd = "2026-02-30";
    expect(feedbackInputErrors(value)).toEqual([expect.stringContaining("周期结束")]);
    value.brief.periodEnd = "2026-01-01";
    expect(feedbackInputErrors(value)).toEqual([expect.stringContaining("周期结束日期不能早于周期开始日期")]);
    value.brief.periodEnd = value.brief.periodStart;
    expect(feedbackInputErrors(value)).toEqual([]);
  });

  it("accepts leap days and valid boundary years", () => {
    const value = input();
    for (const day of ["1900-01-01", "2024-02-29", "2100-12-31"]) {
      value.brief.periodStart = day;
      value.brief.periodEnd = day;
      expect(feedbackInputErrors(value, { lessonAt: `${day}T23:59` })).toEqual([]);
    }
  });

  it("checks subject count, blank names, and duplicates after trimming", () => {
    const value = input("evening");
    value.brief.subjects = Array.from({ length: 11 }, (_, i) => `科目${i}`);
    expect(feedbackInputErrors(value)).toContain("科目最多填写 10 个。");
    value.brief.subjects = ["数学", " 数学 "];
    expect(feedbackInputErrors(value)).toContain("科目名称不能重复，请合并重复的科目。");
    value.brief.subjects = [" ", "字".repeat(51)];
    expect(feedbackInputErrors(value)).toContain("科目名称不能为空，每个名称最多 50 字。");
    value.brief.subjects = ["数学"];
    value.observations.subjects = { "数学": "观察", " 数学 ": "第二条观察" };
    expect(feedbackInputErrors(value)).toContain("个人观察中的科目名称不能重复，请合并重复的科目。");
  });

  it("names each oversized text field while accepting every exact limit", () => {
    const value = input();
    value.brief.teachingContent = "字".repeat(5000);
    value.brief.commonTasks = "字".repeat(5000);
    value.brief.focus = "字".repeat(5000);
    value.observations = {
      performance: "字".repeat(2000), strengths: "字".repeat(2000),
      difficulties: "字".repeat(2000), plan: "字".repeat(2000),
      tasks: "字".repeat(8000), subjects: { 数学: "字".repeat(2000) },
    };
    value.grade = "字".repeat(50);
    value.styleReference = "字".repeat(12000);
    expect(feedbackInputErrors(value, { requirePersonalFacts: true })).toEqual([]);
    const cases = [
      ["教学 / 学习内容", (v: typeof value) => { v.brief.teachingContent += "多"; }],
      ["反馈表达重点", (v: typeof value) => { v.brief.focus += "多"; }],
      ["课堂状态与掌握情况", (v: typeof value) => { v.observations.performance += "多"; }],
      ["值得肯定", (v: typeof value) => { v.observations.strengths += "多"; }],
      ["需要关注", (v: typeof value) => { v.observations.difficulties += "多"; }],
      ["下一步建议", (v: typeof value) => { v.observations.plan += "多"; }],
      ["课后任务", (v: typeof value) => { v.observations.tasks += "多"; }],
      ["第 1 个科目的个人观察", (v: typeof value) => { v.observations.subjects["数学"] += "多"; }],
      ["年级", (v: typeof value) => { v.grade += "多"; }],
      ["个人风格参考", (v: typeof value) => { v.styleReference += "多"; }],
    ] as const;
    for (const [label, change] of cases) {
      const changed = structuredClone(value);
      change(changed);
      expect(feedbackInputErrors(changed)).toEqual([expect.stringContaining(label)]);
    }
  });

  it("lets plans be saved but requires personal observations for AI", () => {
    const value = input();
    value.observations = { ...emptyObservations(), plan: "下次检查变号", tasks: "完成练习" };
    expect(feedbackInputErrors(value)).toEqual([]);
    expect(feedbackInputErrors(value, { requirePersonalFacts: true })).toEqual([expect.stringContaining("先写一条真实观察")]);
    value.observations.subjects = { 数学: "能独立列式" };
    expect(feedbackInputErrors(value, { requirePersonalFacts: true })).toEqual([]);
  });
});

describe("one-on-one lesson task compatibility", () => {
  function lesson(commonTasks = "", tasks = ""): FeedbackSession {
    const session = fixture();
    session.module = "one-to-one";
    session.classId = null;
    session.studentId = "student-1";
    session.brief!.commonTasks = commonTasks;
    session.entries[0].observations!.tasks = tasks;
    return session;
  }

  it.each([
    [" 完成练习册 ", " 订正错题 ", "完成练习册\n订正错题"],
    [" 完成练习册 ", "", "完成练习册"],
    ["", " 订正错题 ", "订正错题"],
    [" 订正错题 ", "订正错题", "订正错题"],
    [" \n ", "\t", ""],
    ["第一题\n第二题", "第二题\n第三题", "第一题\n第二题\n第二题\n第三题"],
  ])("combines task fields without removing distinct notes", (common, individual, expected) => {
    expect(mergeLessonTasks(common, individual)).toBe(expected);
    const normalized = normalizeOneToOneTasks(lesson(common, individual));
    expect(normalized.brief!.commonTasks).toBe("");
    expect(normalized.entries[0].observations!.tasks).toBe(expected);
  });

  it("preserves historical content, review metadata, and all other fields without mutating the source", () => {
    const original = lesson("完成练习册", "订正错题");
    original.entries[0].content = "此前已经发出的历史正文，保持原样。";
    original.entries[0].reviewed = true;
    original.entries[0].generationSource = "ai";
    original.entries[0].generatedFrom = "old-source-signature";
    original.entries[0].observations!.performance = "能独立解题";
    original.entries[0].observations!.subjects = { 数学: "计算准确" };
    const snapshot = structuredClone(original);
    const normalized = normalizeOneToOneTasks(original);
    expect(original).toEqual(snapshot);
    expect(normalized).toEqual({
      ...snapshot,
      brief: { ...snapshot.brief!, commonTasks: "" },
      entries: [{
        ...snapshot.entries[0],
        observations: { ...snapshot.entries[0].observations!, tasks: "完成练习册\n订正错题" },
      }],
    });
    expect(normalized).not.toBe(original);
    expect(normalized.entries[0].observations!.subjects).not.toBe(original.entries[0].observations!.subjects);
  });

  it("moves a legacy common task when no observations object exists", () => {
    const original = lesson("完成本次练习");
    delete original.entries[0].observations;
    const normalized = normalizeOneToOneTasks(original);
    expect(normalized.entries[0].observations).toEqual({ ...emptyObservations(), tasks: "完成本次练习" });
    expect(original.entries[0].observations).toBeUndefined();
  });

  it("retains the entire maximum-size legacy pair below the new 8000-character task limit", () => {
    const common = "共".repeat(5000);
    const individual = "个".repeat(2000);
    const normalized = normalizeOneToOneTasks(lesson(common, individual));
    const tasks = normalized.entries[0].observations!.tasks;
    expect(tasks).toBe(`${common}\n${individual}`);
    expect(tasks).toHaveLength(7001);
    expect(tasks.length).toBeLessThanOrEqual(8000);
    expect(hasFeedbackContent(normalized)).toBe(true);
  });

  it("leaves class modules and sessions without a unique one-on-one target unchanged", () => {
    for (const module of ["evening", "course"] as const) {
      const session = { ...lesson("共同安排", "个人安排"), module };
      expect(normalizeOneToOneTasks(session)).toBe(session);
    }
    const noBrief = lesson();
    delete noBrief.brief;
    expect(normalizeOneToOneTasks(noBrief)).toBe(noBrief);
    const emptyRoster = { ...lesson(), entries: [] };
    expect(normalizeOneToOneTasks(emptyRoster)).toBe(emptyRoster);
    const multiple = lesson("共同安排", "个人安排");
    multiple.entries.push({ studentId: "student-2", content: "另一位学生的正文" });
    expect(normalizeOneToOneTasks(multiple)).toBe(multiple);
    const normalized = lesson("", "已合并的任务");
    expect(normalizeOneToOneTasks(normalized)).toBe(normalized);
  });

  it.each([
    ["共同字段中的旧任务", "个人字段中的旧任务", "共同字段中的旧任务\n个人字段中的旧任务"],
    ["仅共同字段", "", "仅共同字段"],
    ["", "仅个人字段", "仅个人字段"],
    ["相同任务", "相同任务", "相同任务"],
  ])("emits a single lesson task section for either legacy field", (common, individual, expected) => {
    const session = lesson(common, individual);
    const text = outlineFeedback("one-to-one", session.brief!, session.entries[0].observations!);
    expect(text).toBe(`课后任务\n${expected}`);
    expect(text).not.toContain("共同任务");
    expect(text).not.toContain("个人任务");
  });

  it("omits an empty task section and preserves separate task sections for class modes", () => {
    const empty = lesson(" \n", " ");
    expect(outlineFeedback("one-to-one", empty.brief!, empty.entries[0].observations!)).toBe("");
    const session = lesson("共同安排", "个人安排");
    for (const module of ["evening", "course"] as const) {
      expect(outlineFeedback(module, session.brief!, session.entries[0].observations!)).toBe("共同任务\n共同安排\n\n个人任务\n个人安排");
    }
  });
});

describe("feedback periods and subject defaults", () => {
  it("reopens a newly edited monthly draft instead of a later-dated legacy lesson", () => {
    const legacy = {
      ...fixture(),
      id: "legacy",
      lessonAt: "2026-10-21T19:30",
      updatedAt: "2026-10-21T10:00:00.000Z",
    };
    const monthly = {
      ...fixture(),
      id: "monthly",
      module: "course" as const,
      lessonAt: "2026-10-01T00:00",
      updatedAt: "2026-10-21T19:00:00+08:00",
    };
    const source = [legacy, monthly];
    expect(
      sortFeedbackByRecentEdit(source).map((session) => session.id),
    ).toEqual(["monthly", "legacy"]);
    expect(source[0].id).toBe("legacy");
  });
  it("uses Monday through Friday even when opened on a Sunday across months", () => {
    const brief = defaultBrief(
      "evening",
      ["初二"],
      new Date(2026, 10, 1, 23, 59),
    );
    expect(brief.periodStart).toBe("2026-10-26");
    expect(brief.periodEnd).toBe("2026-10-30");
  });
  it("keeps the full calendar month including leap February", () => {
    const brief = defaultBrief("course", ["初三"], new Date(2024, 1, 10));
    expect([brief.periodStart, brief.periodEnd]).toEqual([
      "2024-02-01",
      "2024-02-29",
    ]);
  });
  it("uses the lesson day for one-on-one and defaults evening subjects by grade", () => {
    const brief = defaultBrief(
      "one-to-one",
      ["初三"],
      new Date(2026, 9, 21, 23),
    );
    expect([brief.periodStart, brief.periodEnd]).toEqual([
      "2026-10-21",
      "2026-10-21",
    ]);
    expect(defaultSubjects("evening", ["八年级"])).toEqual(["数学", "物理"]);
    expect(defaultSubjects("evening", ["初二", "初三"])).toEqual([
      "数学",
      "物理",
      "化学",
    ]);
    expect(defaultSubjects("course", ["初三"])).toEqual(["数学"]);
    expect(emptyObservations()).toEqual({
      performance: "",
      strengths: "",
      difficulties: "",
      plan: "",
      tasks: "",
      subjects: {},
    });
  });
});

describe("facts, drafts, and faithful local organization", () => {
  it("allows an unfinished plan to be saved without treating it as observed classroom facts", () => {
    const session = fixture();
    const observations = {
      ...emptyObservations(),
      plan: "下周练习移项",
      tasks: "两道巩固题",
    };
    session.entries[0].observations = observations;
    expect(hasObservations(observations)).toBe(true);
    expect(hasPersonalFacts(observations)).toBe(false);
    expect(hasFeedbackContent(session)).toBe(true);
    expect(
      hasPersonalFacts({
        ...observations,
        subjects: { 物理: "已完成力的示意图练习" },
      }),
    ).toBe(true);
  });
  it("does not save a session merely because dates and default subjects exist", () => {
    const session = fixture();
    expect(hasFeedbackContent(session)).toBe(false);
    session.brief!.teachingContent = "分式运算";
    expect(hasFeedbackContent(session)).toBe(true);
  });
  it("organizes only entered facts and does not turn an internal instruction into a family-facing claim", () => {
    const session = fixture();
    session.brief!.teachingContent = "分式运算";
    session.brief!.focus = "语气温和一些，不要虚构成绩";
    const observations = {
      ...emptyObservations(),
      difficulties: "通分时会漏乘",
      subjects: { 物理: "能画出重力方向", 化学: "" },
      plan: "下周练习两组通分",
    };
    const text = outlineFeedback("evening", session.brief!, observations);
    expect(text).toContain("分式运算");
    expect(text).toContain("通分时会漏乘");
    expect(text).toContain("能画出重力方向");
    expect(text).toContain("下周练习两组通分");
    expect(text).not.toContain("化学情况");
    expect(text).not.toContain("语气温和");
    expect(text).not.toContain("进步显著");
    expect(
      outlineFeedback("evening", session.brief!, emptyObservations()),
    ).toBe("");
  });
});

describe("generated content provenance and concurrent edits", () => {
  it("keeps the pre-style signature unchanged for omitted or empty references", () => {
    const session = fixture();
    const observations = emptyObservations();
    const legacySignature = generationSignature("evening", session.brief!, observations, "初二", session.lessonAt);
    expect(legacySignature).toBe("fnv-5abb1c46e41fcc12");
    expect(generationSignature("evening", session.brief!, observations, "初二", session.lessonAt, "")).toBe(legacySignature);
  });

  it("tracks reference edits without leaking one module's reference into another signature", () => {
    const session = fixture();
    const observations = { ...emptyObservations(), performance: "能口述运算过程" };
    const signature = (module: "one-to-one" | "evening" | "course", reference: string) =>
      generationSignature(module, session.brief!, observations, "初二", session.lessonAt, reference);
    const weekly = signature("evening", "先讲本周变化，再说明下周安排。");
    const changedWeekly = signature("evening", "以学科分段，保持简洁。");
    const monthly = signature("course", "概括本月的学习阶段。");
    expect(weekly).not.toBe(signature("evening", ""));
    expect(changedWeekly).not.toBe(weekly);
    expect(monthly).not.toBe(weekly);
    expect(signature("course", "先讲本周变化，再说明下周安排。")).not.toBe(weekly);
    expect(signature("evening", "先讲本周变化，再说明下周安排。")).toBe(weekly);
    expect(entryIsStale({ studentId: "student-1", content: "此前反馈", generatedFrom: weekly }, changedWeekly)).toBe(true);
  });

  it("uses a compact stable signature independent of record key insertion order", () => {
    const session = fixture();
    const first = {
      ...emptyObservations(),
      subjects: { 数学: "能独立计算", 物理: "能标出重力方向" },
    };
    const second = {
      ...emptyObservations(),
      subjects: { 物理: "能标出重力方向", 数学: "能独立计算" },
    };
    const a = generationSignature(
      "evening",
      session.brief!,
      first,
      "初二",
      session.lessonAt,
    );
    const b = generationSignature(
      "evening",
      session.brief!,
      second,
      "初二",
      session.lessonAt,
    );
    expect(a).toBe(b);
    expect(a.length).toBeLessThan(256);
    expect(a).not.toContain("能独立");
    expect(
      generationSignature(
        "evening",
        { ...session.brief!, teachingContent: "新增章节" },
        first,
        "初二",
        session.lessonAt,
      ),
    ).not.toBe(a);
    expect(
      generationSignature(
        "evening",
        session.brief!,
        first,
        "初三",
        session.lessonAt,
      ),
    ).not.toBe(a);
  });
  it("flags changed source without treating legacy hand-written content as stale AI output", () => {
    expect(
      entryIsStale(
        { studentId: "s", content: "原文", generatedFrom: "old" },
        "new",
      ),
    ).toBe(true);
    expect(
      entryIsStale({ studentId: "s", content: "旧版手写正文" }, "new"),
    ).toBe(false);
    expect(
      entryIsStale(
        { studentId: "s", content: "", generatedFrom: "old" },
        "new",
      ),
    ).toBe(false);
  });
  it("rejects responses after a course switch, common edit, or any teacher edit to that student", () => {
    const started = { epoch: 1, context: 3, entry: 7 };
    expect(canApplyGeneration(started, { ...started })).toBe(true);
    expect(canApplyGeneration(started, { ...started, epoch: 2 })).toBe(false);
    expect(canApplyGeneration(started, { ...started, context: 4 })).toBe(false);
    expect(canApplyGeneration(started, { ...started, entry: 8 })).toBe(false);
  });
  it("does not let save timestamps hide edits made after a save started", () => {
    const before = fixture();
    const submitted = feedbackSnapshot(before);
    expect(
      feedbackSnapshot({ ...before, updatedAt: "2026-10-21T11:00:00.000Z" }),
    ).toBe(submitted);
    const edited = structuredClone(before);
    edited.entries[0].observations!.strengths = "保存期间补写的真实情况";
    expect(feedbackSnapshot(edited)).not.toBe(submitted);
  });
});
