import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDemoData,
  EMPTY_DATA,
  emptyFeedbackEntry,
  loadData,
  parseBackup,
  parseStudentImport,
  pruneFeedbackForStudent,
  removeFeedbackRecord,
  saveData,
  STORAGE_KEY,
  validateStudent,
} from "./data";
import {
  EMPTY_STUDENT,
  type AppData,
  type FeedbackBrief,
  type FeedbackSession,
  type Student,
  type StudentObservations,
} from "./types";

const now = "2026-10-21T08:00:00.000Z";
const student: Student = {
  ...EMPTY_STUDENT,
  id: "student-1",
  name: "小林",
  grade: "七年级",
  phone: "13800000000",
  module: "one-to-one",
  classId: null,
  createdAt: now,
  updatedAt: now,
};
const minimal: AppData = {
  schemaVersion: 1,
  students: [student],
  classes: [],
  records: [],
};
const decode = (data: unknown) => parseBackup(JSON.stringify(data));

function observationFixture(): StudentObservations {
  return {
    performance: "",
    strengths: "",
    difficulties: "",
    plan: "",
    tasks: "",
    subjects: {},
  };
}

function briefFixture(): FeedbackBrief {
  return {
    periodStart: "2026-10-19",
    periodEnd: "2026-10-23",
    subjects: ["数学", "物理"],
    teachingContent: "分式运算；密度计算。",
    commonTasks: "",
    focus: "",
    length: "standard",
  };
}

function feedbackFixture(): AppData & { feedbackSessions: FeedbackSession[] } {
  return {
    ...minimal,
    classes: [
      {
        id: "evening-class",
        module: "evening",
        name: "晚辅班",
        grade: "七年级",
        schedule: "",
        notes: "",
        createdAt: now,
      },
      {
        id: "other-evening-class",
        module: "evening",
        name: "另一晚辅班",
        grade: "七年级",
        schedule: "",
        notes: "",
        createdAt: now,
      },
      {
        id: "course-class",
        module: "course",
        name: "数学班",
        grade: "七年级",
        schedule: "",
        notes: "",
        createdAt: now,
      },
    ],
    students: [
      student,
      {
        ...student,
        id: "evening-student-1",
        module: "evening",
        classId: "evening-class",
      },
      {
        ...student,
        id: "evening-student-2",
        module: "evening",
        classId: "evening-class",
      },
      {
        ...student,
        id: "other-evening-student",
        module: "evening",
        classId: "other-evening-class",
      },
      {
        ...student,
        id: "course-student",
        module: "course",
        classId: "course-class",
      },
    ],
    feedbackSessions: [
      {
        id: "individual-feedback",
        module: "one-to-one",
        classId: null,
        studentId: student.id,
        lessonAt: "2026-10-21T16:30",
        entries: [
          { studentId: student.id, content: "计算过程清晰，继续关注符号。" },
        ],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "evening-feedback",
        module: "evening",
        classId: "evening-class",
        studentId: null,
        lessonAt: "2026-10-21T18:30",
        entries: [
          { studentId: "evening-student-1", content: "作业已订正。" },
          { studentId: "evening-student-2", content: "" },
        ],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "course-feedback",
        module: "course",
        classId: "course-class",
        studentId: null,
        lessonAt: "2026-10-21T09:00",
        entries: [
          { studentId: "course-student", content: "能独立解答本节例题。" },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("bulk student import", () => {
  it("accepts name-only lists and inherits the class grade", () => {
    const rows = parseStudentImport("\uFEFF小林\r\n\r\n小周\r\n", [], "八年级");
    expect(
      rows.map((row) => [row.line, row.fields.name, row.fields.grade]),
    ).toEqual([
      [1, "小林", "八年级"],
      [3, "小周", "八年级"],
    ]);
    expect(rows.every((row) => !row.errors.length)).toBe(true);
  });

  it("supports Excel TSV with missing optional cells and reordered Chinese headers", () => {
    const rows = parseStudentImport(
      "姓名\t家长电话\t年级\t学校\n小林\t13800000000\t七年级\t测试学校\n小陈\t\t八年级\t",
      [],
    );
    expect(rows[0].fields).toMatchObject({
      name: "小林",
      phone: "13800000000",
      grade: "七年级",
      school: "测试学校",
    });
    expect(rows[1].fields.phone).toBe("");
    expect(rows[1].errors).toEqual([]);
  });

  it("supports English headers, quoted commas, escaped quotes and multiline cells", () => {
    const rows = parseStudentImport(
      'name,notes,grade\n小林,"练习,复盘\n关注""符号""",七年级\n小周,复习,八年级',
      [],
    );
    expect(rows[0].fields.notes).toBe('练习,复盘\n关注"符号"');
    expect(rows[0].line).toBe(2);
    expect(rows[1].line).toBe(4);
    expect(rows.every((row) => !row.errors.length)).toBe(true);
  });

  it("uses tabs even when an unquoted TSV cell contains a comma", () => {
    const rows = parseStudentImport(
      "小林\t七年级\t测试,学校\t家长\t\t需复习,检查",
      [],
    );
    expect(rows[0].fields.school).toBe("测试,学校");
    expect(rows[0].fields.notes).toBe("需复习,检查");
  });

  it("flags existing and within-batch duplicates without treating distinct contacts as duplicates", () => {
    const rows = parseStudentImport(
      "小林,七年级,,,13800000000\n小周,七年级\n小周,七年级\n小林,七年级,,,13900000000",
      [student],
    );
    expect(rows.map((row) => row.duplicate)).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it("normalizes whitespace and phone punctuation for duplicate detection", () => {
    const rows = parseStudentImport(" 小林 ,七年级,,,138 0000 0000", [student]);
    expect(rows[0].duplicate).toBe(true);
  });

  it("flags missing names and excess columns", () => {
    expect(parseStudentImport(",七年级", [])[0].errors.join()).toContain(
      "姓名",
    );
    expect(
      parseStudentImport(
        "小林,七年级,学校,家长,电话,备注,多余",
        [],
      )[0].errors.join(),
    ).toContain("列数过多");
  });

  it("rejects ambiguous headers rather than losing unknown columns", () => {
    expect(
      parseStudentImport("姓名,姓名\n小林,小周", [])[0].errors.join(),
    ).toContain("重复");
    expect(
      parseStudentImport("姓名,年龄\n小林,12", [])[0].errors.join(),
    ).toContain("无法识别");
    expect(
      parseStudentImport("姓名,constructor\n小林,12", [])[0].errors.join(),
    ).toContain("无法识别");
    expect(
      parseStudentImport("年级,学校\n七年级,学校", [])[0].errors.join(),
    ).toContain("姓名");
  });

  it("reports malformed CSV quotes", () => {
    expect(
      parseStudentImport('小林,七年级,,,,"未闭合', [])[0].errors.join(),
    ).toContain("未闭合");
    expect(parseStudentImport('"小林"x,七年级', [])[0].errors.join()).toContain(
      "多余字符",
    );
    expect(parseStudentImport('小"林,七年级', [])[0].errors.join()).toContain(
      "引号格式",
    );
  });

  it("does not mark a valid row as duplicate because of an earlier invalid row", () => {
    const rows = parseStudentImport("小林,七年级,,,,,多余\n小林,七年级", []);
    expect(rows[0].errors.length).toBeGreaterThan(0);
    expect(rows[1].duplicate).toBe(false);
  });

  it("accepts empty lists and header-only input", () => {
    expect(parseStudentImport(" \r\n", [])).toEqual([]);
    expect(parseStudentImport("姓名\t年级\n", [])).toEqual([]);
  });
});

describe("student validation", () => {
  it("requires a name and enforces reasonable length limits without requiring a phone", () => {
    expect(validateStudent(EMPTY_STUDENT)).toContain("请填写学生姓名");
    expect(validateStudent({ ...EMPTY_STUDENT, name: "小林" })).toEqual([]);
    expect(
      validateStudent({ ...EMPTY_STUDENT, name: "林".repeat(81) }).join(),
    ).toContain("80");
  });
});

describe("backup integrity", () => {
  it("round-trips valid data and fictional demo data", () => {
    expect(decode(minimal)).toEqual(minimal);
    const demo = createDemoData();
    expect(decode(demo)).toEqual(demo);
    expect(demo.students.every((entry) => entry.phone === "")).toBe(true);
  });

  it("rejects malformed JSON, unsupported schemas and invalid collections", () => {
    expect(() => parseBackup("{broken")).toThrow("JSON");
    expect(() => decode({ ...EMPTY_DATA, schemaVersion: 2 })).toThrow("版本");
    expect(() => decode({ ...EMPTY_DATA, students: {} })).toThrow("列表");
    expect(() => decode(null)).toThrow("格式");
  });

  it("rejects empty student names, missing fields and invalid timestamps", () => {
    expect(() =>
      decode({ ...minimal, students: [{ ...student, name: " " }] }),
    ).toThrow("姓名");
    expect(() =>
      decode({ ...minimal, students: [{ ...student, school: null }] }),
    ).toThrow("学校");
    expect(() =>
      decode({
        ...minimal,
        students: [{ ...student, createdAt: "2026-02-30T08:00:00.000Z" }],
      }),
    ).toThrow("日期");
  });

  it("rejects duplicate ids, missing classes and mismatched modules", () => {
    expect(() => decode({ ...minimal, students: [student, student] })).toThrow(
      "重复 ID",
    );
    expect(() =>
      decode({
        ...minimal,
        students: [{ ...student, module: "evening", classId: "missing" }],
      }),
    ).toThrow("不存在");
    expect(() =>
      decode({ ...minimal, students: [{ ...student, classId: "class-1" }] }),
    ).toThrow("一对一");
    const demo = createDemoData();
    const evening = demo.students.find((entry) => entry.module === "evening")!;
    evening.classId = demo.classes.find(
      (entry) => entry.module === "course",
    )!.id;
    expect(() => decode(demo)).toThrow("不一致");
  });

  it("rejects lone Unicode surrogates in ids while accepting valid Unicode pairs", () => {
    for (const invalidId of ["\ud800", "\udfff", "student-\ud800-end"]) {
      expect(() =>
        decode({ ...minimal, students: [{ ...student, id: invalidId }] }),
      ).toThrow("无效 Unicode");
    }
    const demo = createDemoData();
    demo.classes[0].id = "\ud800";
    expect(() => decode(demo)).toThrow("无效 Unicode");
    expect(() =>
      decode({
        ...minimal,
        records: [
          {
            id: "\udfff",
            studentId: student.id,
            date: "2026-10-21",
            content: "笔记",
            createdAt: now,
          },
        ],
      }),
    ).toThrow("无效 Unicode");
    const valid = decode({
      ...minimal,
      students: [{ ...student, id: "学生-\ud83d\ude00" }],
    });
    expect(() => encodeURIComponent(valid.students[0].id)).not.toThrow();
  });

  it("rejects orphaned records, impossible dates and empty record content", () => {
    const record = {
      id: "note-1",
      studentId: student.id,
      date: "2026-10-21",
      content: "课堂笔记",
      createdAt: now,
    };
    expect(() =>
      decode({ ...minimal, records: [{ ...record, studentId: "missing" }] }),
    ).toThrow("不存在");
    expect(() =>
      decode({ ...minimal, records: [{ ...record, date: "2026-02-30" }] }),
    ).toThrow("日期");
    expect(() =>
      decode({ ...minimal, records: [{ ...record, content: "" }] }),
    ).toThrow("内容");
  });

  it("copies only the expected schema fields", () => {
    const result = decode({
      ...minimal,
      malicious: "ignored",
      students: [{ ...student, surprise: "ignored" }],
    });
    expect(result).toEqual(minimal);
  });
});

describe("module-specific feedback style backups", () => {
  it("round-trips all module references without changing whitespace or mixing modules", () => {
    const feedbackStyles = {
      "one-to-one": "  先说明本节课的掌握情况。\n再给具体练习建议。  ",
      evening: "用一周的观察概括不同学科，不逐日罗列。",
      course: "本月学习进展分两段说明。",
    };
    const data = { ...feedbackFixture(), feedbackStyles };
    const restored = decode(data);
    expect(restored).toEqual(data);
    expect(decode(restored)).toEqual(data);
    expect(restored.feedbackStyles).not.toBe(feedbackStyles);
  });

  it("preserves absent, partial, empty-object and explicit empty-string settings", () => {
    expect(Object.hasOwn(decode(minimal), "feedbackStyles")).toBe(false);
    expect(decode(minimal)).toEqual(minimal);
    for (const feedbackStyles of [{}, { evening: "" }, { "one-to-one": "单人风格" }]) {
      expect(decode({ ...minimal, feedbackStyles }).feedbackStyles).toEqual(feedbackStyles);
    }
    const partial = decode({ ...minimal, feedbackStyles: { evening: "晚辅风格" } });
    expect(Object.hasOwn(partial.feedbackStyles!, "course")).toBe(false);
    expect(Object.hasOwn(partial.feedbackStyles!, "one-to-one")).toBe(false);
  });

  it.each(["one-to-one", "evening", "course"])("accepts the exact reference limit for %s and rejects one extra character", (module) => {
    const reference = "参".repeat(12_000);
    expect(decode({ ...minimal, feedbackStyles: { [module]: reference } }).feedbackStyles).toEqual({ [module]: reference });
    expect(() => decode({ ...minimal, feedbackStyles: { [module]: `${reference}多` } })).toThrow("12000");
  });

  it.each(["shared", "oneToOne", "constructor", "__proto__", "", "course "])("rejects unrecognized or prototype-style module key %s", (module) => {
    const feedbackStyles = Object.fromEntries([[module, "不应跨模块使用的参考"]]);
    expect(() => decode({ ...minimal, feedbackStyles })).toThrow("模块");
  });

  it.each([null, [], "文本", 0, false])("rejects a non-object feedbackStyles value", (feedbackStyles) => {
    expect(() => decode({ ...minimal, feedbackStyles })).toThrow("反馈风格参考");
  });

  it.each([null, 42, true, {}, []])("rejects a non-string module reference", (reference) => {
    expect(() => decode({ ...minimal, feedbackStyles: { evening: reference } })).toThrow("反馈风格参考");
  });
});

describe("course feedback backups", () => {
  it("keeps legacy schema-v1 backups unchanged and preserves a supplied empty feedback list", () => {
    expect(decode(minimal)).toEqual(minimal);
    expect(Object.hasOwn(decode(minimal), "feedbackSessions")).toBe(false);
    const withEmptyFeedback = { ...minimal, feedbackSessions: [] };
    expect(decode(withEmptyFeedback)).toEqual(withEmptyFeedback);
  });

  it("round-trips individual, evening and course feedback including partially completed drafts", () => {
    const data = feedbackFixture();
    expect(decode(data)).toEqual(data);
    data.feedbackSessions[1].entries[1].content = " \n ";
    expect(decode(data)).toEqual(data);
  });

  it("round-trips one-to-one lesson numbers and leaves old backup shapes unchanged", () => {
    const data = feedbackFixture();
    expect(Object.hasOwn(decode(data).feedbackSessions![0], "lessonNumber")).toBe(false);
    for (const lessonNumber of [1, 8, 9999]) {
      data.feedbackSessions[0].lessonNumber = lessonNumber;
      expect(decode(data)).toEqual(data);
    }
    const nullable = feedbackFixture();
    expect(decode({ ...nullable, feedbackSessions: nullable.feedbackSessions.map((item) => ({ ...item, lessonNumber: null })) })).toEqual(nullable);
  });

  it("rejects invalid lesson numbers and lesson numbers on grouped feedback", () => {
    const data = feedbackFixture();
    for (const lessonNumber of [0, -1, 1.5, 10000, "8", true, {}, []]) {
      expect(() => decode({ ...data, feedbackSessions: [{ ...data.feedbackSessions[0], lessonNumber }] })).toThrow("课次");
    }
    for (const group of data.feedbackSessions.slice(1)) {
      expect(() => decode({ ...data, feedbackSessions: [{ ...group, lessonNumber: 8 }] })).toThrow("晚辅和班课不能填写课次");
    }
  });

  it("round-trips editable one-to-one titles and normalizes null titles in old backups", () => {
    const data = feedbackFixture();
    for (const title of ["亦琳第9次数学课（10.21）", "", "字".repeat(300)]) {
      data.feedbackSessions[0].title = title;
      expect(decode(data)).toEqual(data);
    }
    const old = feedbackFixture();
    expect(decode({ ...old, feedbackSessions: old.feedbackSessions.map((item) => ({ ...item, title: null })) })).toEqual(old);
  });

  it("rejects malformed or oversized titles and titles on group feedback", () => {
    const data = feedbackFixture();
    for (const title of [123, true, {}, [], "字".repeat(301)]) {
      expect(() => decode({ ...data, feedbackSessions: [{ ...data.feedbackSessions[0], title }] })).toThrow("反馈标题");
    }
    for (const group of data.feedbackSessions.slice(1)) {
      for (const title of ["", "标题"]) expect(() => decode({ ...data, feedbackSessions: [{ ...group, title }] })).toThrow("标题仅适用于一对一");
    }
  });

  it.each([
    "2026-02-30T16:30",
    "2026-10-21T24:00",
    "2026-10-21T16:60",
    "2026-10-21 16:30",
    "2026-10-21T16:30:00",
    null,
  ])("rejects an invalid local lesson time: %s", (lessonAt) => {
    const data = feedbackFixture();
    expect(() =>
      decode({
        ...data,
        feedbackSessions: [{ ...data.feedbackSessions[0], lessonAt }],
      }),
    ).toThrow("上课时间");
  });

  it("accepts a leap-day lesson time", () => {
    const data = feedbackFixture();
    data.feedbackSessions[0].lessonAt = "2028-02-29T00:00";
    expect(decode(data)).toEqual(data);
  });

  it("rejects wrong feedback target types and cross-module classes", () => {
    const data = feedbackFixture();
    const individual = data.feedbackSessions[0];
    const group = data.feedbackSessions[1];
    for (const malformed of [
      { ...individual, classId: "evening-class" },
      { ...individual, studentId: "missing" },
      { ...individual, studentId: "evening-student-1" },
      { ...group, studentId: "evening-student-1" },
      { ...group, classId: "course-class" },
      { ...group, classId: null },
      { ...group, module: "constructor" },
    ]) {
      expect(() =>
        decode({ ...data, feedbackSessions: [malformed] }),
      ).toThrow();
    }
  });

  it("requires exactly the target student's entry for one-to-one feedback", () => {
    const data = feedbackFixture();
    const individual = data.feedbackSessions[0];
    expect(() =>
      decode({
        ...data,
        feedbackSessions: [{ ...individual, entries: [] }],
      }),
    ).toThrow("一条反馈");
    expect(() =>
      decode({
        ...data,
        feedbackSessions: [
          {
            ...individual,
            entries: [{ studentId: "evening-student-1", content: "内容" }],
          },
        ],
      }),
    ).toThrow("不一致");
  });

  it("rejects entries from another class in the same module, another module and nonexistent students", () => {
    const data = feedbackFixture();
    for (const studentId of [
      "other-evening-student",
      "course-student",
      "missing",
    ]) {
      expect(() =>
        decode({
          ...data,
          feedbackSessions: [
            {
              ...data.feedbackSessions[1],
              entries: [{ studentId, content: "内容" }],
            },
          ],
        }),
      ).toThrow("不一致");
    }
  });

  it("rejects repeated students, empty sessions and invalid content", () => {
    const data = feedbackFixture();
    const group = data.feedbackSessions[1];
    expect(() =>
      decode({
        ...data,
        feedbackSessions: [
          { ...group, entries: [group.entries[0], group.entries[0]] },
        ],
      }),
    ).toThrow("重复学生");
    for (const entries of [
      [],
      [{ studentId: "evening-student-1", content: " \n " }],
    ]) {
      expect(() =>
        decode({
          ...data,
          feedbackSessions: [{ ...group, entries }],
        }),
      ).toThrow("非空反馈");
    }
    for (const content of [null, {}, "字".repeat(10_001)]) {
      expect(() =>
        decode({
          ...data,
          feedbackSessions: [
            {
              ...group,
              entries: [{ studentId: "evening-student-1", content }],
            },
          ],
        }),
      ).toThrow("反馈内容");
    }
  });

  it("validates global feedback ids and rejects malformed collection or entry shapes", () => {
    const data = feedbackFixture();
    const group = data.feedbackSessions[1];
    expect(() =>
      decode({
        ...data,
        feedbackSessions: [{ ...group, id: student.id }],
      }),
    ).toThrow("重复 ID");
    expect(() =>
      decode({
        ...data,
        feedbackSessions: [group, group],
      }),
    ).toThrow("重复 ID");
    expect(() =>
      decode({
        ...data,
        feedbackSessions: [{ ...group, id: "\ud800" }],
      }),
    ).toThrow("无效 Unicode");
    for (const feedbackSessions of [
      null,
      {},
      [null],
      [{ ...group, entries: {} }],
      [{ ...group, entries: [null] }],
    ]) {
      expect(() => decode({ ...data, feedbackSessions })).toThrow();
    }
    expect(() =>
      decode({
        ...data,
        feedbackSessions: [{ ...group, updatedAt: "not-a-date" }],
      }),
    ).toThrow("更新时间");
  });

  it("bounds the number of sessions and entries", () => {
    const data = feedbackFixture();
    const group = data.feedbackSessions[1];
    expect(() =>
      decode({
        ...data,
        feedbackSessions: Array(20_001).fill(null),
      }),
    ).toThrow("20000");
    expect(() =>
      decode({
        ...data,
        feedbackSessions: [{ ...group, entries: Array(50_001).fill(null) }],
      }),
    ).toThrow("50000");
  });
});

describe("structured feedback draft backups", () => {
  it("preserves all optional fields and leaves old feedback shape unchanged", () => {
    const oldData = feedbackFixture();
    expect(decode(oldData)).toEqual(oldData);
    expect(Object.hasOwn(decode(oldData).feedbackSessions![0], "brief")).toBe(
      false,
    );
    expect(
      Object.hasOwn(
        decode(oldData).feedbackSessions![0].entries[0],
        "reviewed",
      ),
    ).toBe(false);
    const data = feedbackFixture();
    data.feedbackSessions[1].brief = briefFixture();
    data.feedbackSessions[1].entries[0] = {
      ...data.feedbackSessions[1].entries[0],
      observations: {
        ...observationFixture(),
        performance: "周三独立完成，周四有两次走神。",
        subjects: { 数学: "分母通分仍需提醒。" },
      },
      reviewed: false,
      generationSource: "ai",
      generatedFrom: "facts-2e63f910",
    };
    expect(decode(data)).toEqual(data);
  });

  it.each([
    "performance",
    "strengths",
    "difficulties",
    "plan",
    "tasks",
  ] as const)("keeps a notes-only draft using the %s field", (field) => {
    const data = feedbackFixture();
    data.feedbackSessions[0].entries[0] = {
      studentId: student.id,
      content: "",
      observations: { ...observationFixture(), [field]: "真实事实关键词" },
    };
    expect(decode(data)).toEqual(data);
  });

  it("round-trips a merged one-to-one task without truncating legacy fields", () => {
    const data = feedbackFixture();
    const tasks = `${"甲".repeat(5000)}\n${"乙".repeat(2000)}`;
    data.feedbackSessions[0].entries[0] = {
      studentId: student.id,
      content: "",
      observations: { ...observationFixture(), tasks },
    };
    expect(decode(data)).toEqual(data);
    data.feedbackSessions[0].entries[0].observations!.tasks = "字".repeat(8001);
    expect(() => decode(data)).toThrow("作业任务事实");
  });

  it("allows a subject-only observation draft before generating prose", () => {
    const data = feedbackFixture();
    data.feedbackSessions[0].entries[0] = {
      studentId: student.id,
      content: "",
      observations: {
        ...observationFixture(),
        subjects: { 化学: "化学式角标漏写" },
      },
    };
    expect(decode(data)).toEqual(data);
  });

  it.each(["teachingContent", "commonTasks", "focus"] as const)(
    "allows a common-brief draft with only %s",
    (field) => {
      const data = feedbackFixture();
      data.feedbackSessions[1].entries = [];
      data.feedbackSessions[1].brief = {
        ...briefFixture(),
        teachingContent: "",
        commonTasks: "",
        focus: "",
        [field]: "本周共用内容",
      };
      expect(decode(data)).toEqual(data);
    },
  );

  it("does not treat dates, selected subjects, flags or whitespace as meaningful draft content", () => {
    const data = feedbackFixture();
    data.feedbackSessions[0].entries[0] = {
      studentId: student.id,
      content: "  ",
      observations: {
        ...observationFixture(),
        strengths: "\n",
        subjects: { 数学: " \t" },
      },
      reviewed: true,
      generationSource: "manual",
      generatedFrom: "signature",
    };
    data.feedbackSessions[0].brief = {
      ...briefFixture(),
      teachingContent: " \n",
      commonTasks: "",
      focus: "",
    };
    expect(() => decode(data)).toThrow("非空反馈");
  });

  it.each([
    ["2026-02-30", "2026-03-01"],
    ["2026-10-23", "2026-10-19"],
    ["1899-12-31", "1900-01-01"],
    ["2100-12-31", "2101-01-01"],
    ["2026-1-1", "2026-01-02"],
  ])(
    "rejects invalid or reversed period %s to %s",
    (periodStart, periodEnd) => {
      const data = feedbackFixture();
      data.feedbackSessions[1].brief = {
        ...briefFixture(),
        periodStart,
        periodEnd,
      };
      expect(() => decode(data)).toThrow("日期");
    },
  );

  it("accepts a same-day leap-year period and validates every brief field", () => {
    const data = feedbackFixture();
    const session = data.feedbackSessions[1];
    const valid = {
      ...briefFixture(),
      periodStart: "2028-02-29",
      periodEnd: "2028-02-29",
    };
    data.feedbackSessions[1].brief = valid;
    expect(decode(data)).toEqual(data);
    for (const malformed of [
      null,
      [],
      { ...valid, length: "long" },
      { ...valid, teachingContent: null },
      { ...valid, teachingContent: "字".repeat(5001) },
      { ...valid, commonTasks: "字".repeat(5001) },
      { ...valid, focus: "字".repeat(5001) },
    ]) {
      expect(() =>
        decode({
          ...data,
          feedbackSessions: [{ ...session, brief: malformed }],
        }),
      ).toThrow();
    }
  });

  it("requires a unique bounded subject list and normalizes outer whitespace", () => {
    const data = feedbackFixture();
    const session = data.feedbackSessions[1];
    data.feedbackSessions[1].brief = {
      ...briefFixture(),
      subjects: [" 数学 ", "物理"],
    };
    expect(decode(data).feedbackSessions![1].brief!.subjects).toEqual([
      "数学",
      "物理",
    ]);
    for (const subjects of [
      {},
      [""],
      [" "],
      ["数学", " 数学 "],
      ["科".repeat(51)],
      Array.from({ length: 11 }, (_, i) => `科目${i}`),
    ]) {
      expect(() =>
        decode({
          ...data,
          feedbackSessions: [
            { ...session, brief: { ...briefFixture(), subjects } },
          ],
        }),
      ).toThrow("学科");
    }
  });

  it("validates all observation fields and their own subject keys", () => {
    const data = feedbackFixture();
    const session = data.feedbackSessions[0];
    for (const malformed of [
      null,
      [],
      { ...observationFixture(), performance: null },
      { ...observationFixture(), strengths: "字".repeat(2001) },
      { ...observationFixture(), difficulties: "字".repeat(2001) },
      { ...observationFixture(), plan: "字".repeat(2001) },
      { ...observationFixture(), tasks: "字".repeat(8001) },
      { ...observationFixture(), subjects: [] },
      { ...observationFixture(), subjects: { " ": "事实" } },
      { ...observationFixture(), subjects: { ["科".repeat(51)]: "事实" } },
      { ...observationFixture(), subjects: { 数学: "字".repeat(2001) } },
      { ...observationFixture(), subjects: { 数学: "事实", " 数学 ": "重复" } },
      {
        ...observationFixture(),
        subjects: Object.fromEntries(
          Array.from({ length: 11 }, (_, i) => [`学科${i}`, "事实"]),
        ),
      },
    ]) {
      expect(() =>
        decode({
          ...data,
          feedbackSessions: [
            {
              ...session,
              entries: [{ ...session.entries[0], observations: malformed }],
            },
          ],
        }),
      ).toThrow();
    }
  });

  it("handles prototype-like subject names as own text without inherited properties", () => {
    const data = feedbackFixture();
    data.feedbackSessions[0].entries[0].observations = {
      ...observationFixture(),
      subjects: JSON.parse(
        '{"__proto__":"事实一","constructor":"事实二"}',
      ) as Record<string, string>,
    };
    const subjects =
      decode(data).feedbackSessions![0].entries[0].observations!.subjects;
    expect(Object.getPrototypeOf(subjects)).toBeNull();
    expect(Object.hasOwn(subjects, "__proto__")).toBe(true);
    expect(subjects.__proto__).toBe("事实一");
    expect(subjects.constructor).toBe("事实二");
    expect(subjects.toString).toBeUndefined();
    expect({}.toString).toBe(Object.prototype.toString);
  });

  it("enforces a boolean reviewed flag, known source and bounded generation signature", () => {
    const data = feedbackFixture();
    const session = data.feedbackSessions[0];
    for (const patch of [
      { reviewed: "false" },
      { reviewed: null },
      { reviewed: 0 },
      { generationSource: "constructor" },
      { generationSource: null },
      { generatedFrom: "x".repeat(257) },
      { generatedFrom: {} },
    ]) {
      expect(() =>
        decode({
          ...data,
          feedbackSessions: [
            { ...session, entries: [{ ...session.entries[0], ...patch }] },
          ],
        }),
      ).toThrow();
    }
    for (const generationSource of ["ai", "manual", "outline"] as const) {
      data.feedbackSessions[0].entries[0] = {
        ...session.entries[0],
        reviewed: true,
        generationSource,
        generatedFrom: "x".repeat(256),
      };
      expect(decode(data)).toEqual(data);
    }
  });
});

describe("feedback cleanup when deleting a student", () => {
  it("deletes only the selected historical session and leaves every other session intact", () => {
    const sessions = feedbackFixture().feedbackSessions;
    const before = structuredClone(sessions);
    expect(removeFeedbackRecord(sessions, sessions[0].id)).toEqual(sessions.slice(1));
    expect(removeFeedbackRecord(sessions, "unknown")).toEqual(sessions);
    expect(sessions).toEqual(before);
  });

  it("clears personal history to the canonical empty entry while preserving classmates and other periods", () => {
    const sessions = feedbackFixture().feedbackSessions;
    sessions[1].entries[1].content = "其他同学的正文";
    const before = structuredClone(sessions);
    const result = removeFeedbackRecord(sessions, sessions[1].id, "evening-student-1");
    expect(result[1].entries).toEqual([emptyFeedbackEntry("evening-student-1"), sessions[1].entries[1]]);
    expect(result[0]).toBe(sessions[0]);
    expect(result[2]).toBe(sessions[2]);
    expect(sessions).toEqual(before);
    expect(removeFeedbackRecord(sessions, sessions[1].id, "missing")).toEqual(sessions);
  });

  it("removes a now-empty personal history session but retains useful shared course information", () => {
    const sessions = feedbackFixture().feedbackSessions;
    expect(removeFeedbackRecord(sessions, sessions[1].id, "evening-student-1").map((item) => item.id)).not.toContain(sessions[1].id);
    sessions[1].brief = briefFixture();
    const result = removeFeedbackRecord(sessions, sessions[1].id, "evening-student-1");
    expect(result[1].entries[0]).toEqual(emptyFeedbackEntry("evening-student-1"));
    expect(result[1].brief).toEqual(sessions[1].brief);
  });

  it("removes the student's one-to-one sessions and preserves unrelated feedback", () => {
    const sessions = feedbackFixture().feedbackSessions;
    const result = pruneFeedbackForStudent(sessions, student.id);
    expect(result).toEqual(sessions.slice(1));
    expect(sessions).toHaveLength(3);
    expect(result[0]).toBe(sessions[1]);
  });

  it("removes only the matching class entry and preserves other students' exact content", () => {
    const sessions = feedbackFixture().feedbackSessions;
    sessions[1].entries[1].content = " 需要保留的反馈\n第二行 ";
    const result = pruneFeedbackForStudent(sessions, "evening-student-1");
    expect(result).toHaveLength(3);
    expect(result[1].entries).toEqual([
      { studentId: "evening-student-2", content: " 需要保留的反馈\n第二行 " },
    ]);
    expect(sessions[1].entries).toHaveLength(2);
  });

  it("drops a class session when deleting its last nonblank feedback", () => {
    const sessions = feedbackFixture().feedbackSessions;
    const result = pruneFeedbackForStudent(sessions, "evening-student-1");
    expect(result.map((session) => session.id)).toEqual([
      "individual-feedback",
      "course-feedback",
    ]);
  });

  it("can remove a blank entry while retaining the completed feedback", () => {
    const sessions = feedbackFixture().feedbackSessions;
    const result = pruneFeedbackForStudent(sessions, "evening-student-2");
    expect(result[1].entries).toEqual([sessions[1].entries[0]]);
    expect(result[1].entries[0].content).toBe("作业已订正。");
  });

  it("keeps another student's facts-only draft when removing a classmate", () => {
    const sessions = feedbackFixture().feedbackSessions;
    sessions[1].entries[1].observations = {
      ...observationFixture(),
      difficulties: "遇到难题先空着",
    };
    const result = pruneFeedbackForStudent(sessions, "evening-student-1");
    expect(result[1].id).toBe(sessions[1].id);
    expect(result[1].entries).toEqual([sessions[1].entries[1]]);
    expect(sessions[1].entries).toHaveLength(2);
  });

  it("keeps a useful shared brief even after removing its last student entry", () => {
    const sessions = feedbackFixture().feedbackSessions;
    sessions[1].brief = briefFixture();
    sessions[1].entries = [sessions[1].entries[0]];
    const result = pruneFeedbackForStudent(sessions, "evening-student-1");
    expect(result[1].brief).toEqual(briefFixture());
    expect(result[1].entries).toEqual([]);
  });
});

describe("local persistence", () => {
  function mockStorage(initial: string | null = null) {
    let saved = initial;
    const storage = {
      getItem: vi.fn(() => saved),
      setItem: vi.fn((_key: string, value: string) => {
        saved = value;
      }),
    };
    vi.stubGlobal("localStorage", storage);
    return storage;
  }

  it("starts empty and persists an exact reload", () => {
    const storage = mockStorage();
    expect(loadData()).toEqual({ data: EMPTY_DATA, error: null });
    saveData(minimal);
    expect(storage.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      JSON.stringify(minimal),
    );
    expect(loadData()).toEqual({ data: minimal, error: null });
  });

  it("persists feedback sessions through a reload", () => {
    mockStorage();
    const data = feedbackFixture();
    saveData(data);
    expect(loadData()).toEqual({ data, error: null });
  });

  it("preserves invalid stored data and returns a blocking error", () => {
    const storage = mockStorage("{bad data");
    const result = loadData();
    expect(result.data).toEqual(EMPTY_DATA);
    expect(result.error).toContain("原数据已保留");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("reports storage denial and quota errors instead of claiming success", () => {
    const storage = mockStorage();
    storage.getItem.mockImplementation(() => {
      throw new Error("Access denied");
    });
    expect(loadData().error).toContain("无法读取");
    storage.setItem.mockImplementation(() => {
      throw new Error("Quota exceeded");
    });
    expect(() => saveData(minimal)).toThrow("无法保存");
  });

  it("validates data before overwriting a valid store", () => {
    const storage = mockStorage(JSON.stringify(minimal));
    expect(() =>
      saveData({ ...minimal, students: [{ ...student, name: "" }] }),
    ).toThrow("姓名");
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
