import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDemoData,
  EMPTY_DATA,
  loadData,
  parseBackup,
  parseStudentImport,
  pruneFeedbackForStudent,
  saveData,
  STORAGE_KEY,
  validateStudent,
} from "./data";
import {
  EMPTY_STUDENT,
  type AppData,
  type FeedbackSession,
  type Student,
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

describe("feedback cleanup when deleting a student", () => {
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
