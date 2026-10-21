import { describe, expect, it } from "vitest";
import { entryRate, exportExamCsv, parseExamPaste, previousExam, sortExams, summarizeExam } from "./examModel";
import { EMPTY_STUDENT, type Exam, type ExamEntry, type Student } from "./types";

const timestamp = "2026-10-21T08:00:00.000Z";
const students: Student[] = ["张瑶", "李亦琳", "陈测试"].map((name, index) => ({
  ...EMPTY_STUDENT, name, id: `s${index}`, module: "course", classId: "class", school: index === 2 ? "二中" : "一中",
  createdAt: timestamp, updatedAt: timestamp,
}));
const entry = (index: number, score: number | null, maxScore = 100, status: ExamEntry["status"] = score === null ? "pending" : "recorded"): ExamEntry => ({
  studentId: `s${index}`, school: students[index]?.school ?? "", score, maxScore, status,
});
const exam = (entries: ExamEntry[] = [], overrides: Partial<Exam> = {}): Exam => ({
  id: "e1", classId: "class", name: "第一次月考", subject: "数学", date: "2026-10-21", defaultMaxScore: 150,
  entries, createdAt: timestamp, updatedAt: timestamp, ...overrides,
});

describe("exam statistics", () => {
  it("excludes missing and absent scores from averages but includes a real zero", () => {
    const summary = summarizeExam(exam([entry(0, 0), entry(1, null), entry(2, null, 100, "absent")]));
    expect(summary).toMatchObject({ total: 3, count: 1, pending: 1, absent: 1, meanScore: 0, meanRate: 0, medianRate: 0, atLeast60: 0 });
    expect(summary.bands.map((band) => band.count)).toEqual([1, 0, 0, 0]);
  });

  it("uses percentages for mixed maximums and never creates a mixed raw-score mean", () => {
    const summary = summarizeExam(exam([entry(0, 120, 150), entry(1, 80, 100), entry(2, 72, 120)]));
    expect(summary.meanScore).toBeNull();
    expect(summary.commonMaxScore).toBeNull();
    expect(summary.meanRate).toBeCloseTo(220 / 3);
    expect(summary.medianRate).toBe(80);
    expect(summary.atLeast60).toBe(3);
    expect(summary.schoolGroups).toEqual([
      { school: "二中", maxScore: 120, count: 1, meanScore: 72, meanRate: 60 },
      { school: "一中", maxScore: 100, count: 1, meanScore: 80, meanRate: 80 },
      { school: "一中", maxScore: 150, count: 1, meanScore: 120, meanRate: 80 },
    ]);
  });

  it("computes the raw mean only with a common maximum and preserves decimals", () => {
    const summary = summarizeExam(exam([entry(0, 82.5, 150), entry(1, 127.5, 150)]));
    expect(summary).toMatchObject({ meanScore: 105, commonMaxScore: 150, meanRate: 70, medianRate: 70 });
    expect(summary.schoolGroups[0]).toMatchObject({ count: 2, meanScore: 105, meanRate: 70 });
  });

  it("uses nonoverlapping bands with correct 60, 75, 85 and 100 percent boundaries", () => {
    const scores = [0, 59.99, 60, 74.99, 75, 84.99, 85, 100];
    const summary = summarizeExam(exam(scores.map((score, index) => entry(index, score))));
    expect(summary.bands.map((band) => band.count)).toEqual([2, 2, 2, 2]);
    expect(summary.atLeast60).toBe(6);
    expect(summary.atLeast85).toBe(2);
  });

  it("returns empty values instead of NaN when nobody has a valid score", () => {
    const summary = summarizeExam(exam([entry(0, null), entry(1, null, 100, "absent")]));
    expect(summary).toMatchObject({ count: 0, meanScore: null, meanRate: null, medianRate: null, commonMaxScore: null, schoolGroups: [] });
    expect(summary.bands.every((band) => band.count === 0)).toBe(true);
  });

  it.each([
    entry(0, Infinity), entry(0, NaN), entry(0, -1), entry(0, 101), entry(0, 10, 0), entry(0, 10, Infinity), entry(0, 10, 1001),
    entry(0, 80, 100, "absent"), entry(0, 80, 100, "pending"),
  ])("does not count invalid or non-recorded input as a score", (invalid) => {
    expect(entryRate(invalid)).toBeNull();
    expect(summarizeExam(exam([invalid])).count).toBe(0);
  });

  it("does not double count duplicate student entries and leaves its input untouched", () => {
    const value = exam([entry(0, 60), entry(0, 80), entry(1, 80)]);
    const before = structuredClone(value);
    expect(summarizeExam(value)).toMatchObject({ total: 2, count: 2, meanRate: 80 });
    expect(value).toEqual(before);
  });

  it("groups missing schools separately without borrowing current student information", () => {
    const value = exam([{ ...entry(0, 60), school: " " }, { ...entry(1, 80), school: "原学校" }]);
    expect(summarizeExam(value).schoolGroups.map((group) => group.school)).toEqual(["", "原学校"]);
  });
});

describe("exam history", () => {
  it("chooses only an earlier exam in the same class and subject", () => {
    const current = exam();
    const older = exam([], { id: "older", date: "2026-09-20" });
    const values = [
      older, exam([], { id: "newer", date: "2026-10-22" }), exam([], { id: "same-day" }),
      exam([], { id: "wrong-subject", date: "2026-10-20", subject: "物理" }),
      exam([], { id: "wrong-class", date: "2026-10-20", classId: "other" }),
    ];
    expect(previousExam(values, current)).toBe(older);
    expect(previousExam([current], current)).toBeUndefined();
  });

  it("sorts by actual date rather than recent editing and does not mutate the input", () => {
    const older = exam([], { id: "older", date: "2026-09-20", updatedAt: "2026-11-01T08:00:00.000Z" });
    const newer = exam([], { id: "newer" });
    const values = [older, newer];
    expect(sortExams(values)).toEqual([newer, older]);
    expect(values).toEqual([older, newer]);
  });
});

describe("exam score paste preview", () => {
  it("reads Excel cells, matches names and keeps existing full scores and school snapshots", () => {
    const value = exam([{ ...entry(0, 20, 120), school: "当次学校" }]);
    const rows = parseExamPaste("姓名\t成绩\t满分\r\n张瑶\t90\t\r\n李亦琳\t127.5\t150", students, value);
    expect(rows.map((row) => row.errors)).toEqual([[], []]);
    expect(rows[0]).toMatchObject({ line: 2, name: "张瑶", entry: { studentId: "s0", score: 90, maxScore: 120, school: "当次学校", status: "recorded" } });
    expect(rows[1].entry).toMatchObject({ score: 127.5, maxScore: 150, school: "一中" });
  });

  it("uses the exam default for new students and supports quoted CSV with reordered headers", () => {
    const rows = parseExamPaste('\uFEFF成绩,姓名\n"０","张瑶"\n.5,李亦琳', students, exam());
    expect(rows.map((row) => row.entry?.score)).toEqual([0, 0.5]);
    expect(rows.every((row) => row.entry?.maxScore === 150)).toBe(true);
  });

  it.each([NaN, Infinity, 0, -1, 1001])("reports an invalid existing row maximum %s instead of falling back silently", (maxScore) => {
    const value = exam([{ ...entry(0, -20, maxScore), school: "当次学校" }]);
    const row = parseExamPaste("张瑶,80", students, value)[0];
    expect(row.errors.join()).toContain("满分须");
    expect(row.entry).toBeUndefined();
    const corrected = parseExamPaste("张瑶,80,120", students, value)[0];
    expect(corrected.errors).toEqual([]);
    expect(corrected.entry).toMatchObject({ score: 80, maxScore: 120, school: "当次学校" });
  });

  it("distinguishes missing scores, absences and zero", () => {
    const rows = parseExamPaste("张瑶,0,100\n李亦琳,缺考,100\n陈测试,未录,100", students, exam());
    expect(rows.map((row) => [row.entry?.status, row.entry?.score])).toEqual([["recorded", 0], ["absent", null], ["pending", null]]);
    expect(parseExamPaste("张瑶\t", students, exam())[0].entry?.status).toBe("pending");
  });

  it("identifies unknown, same-name, cross-class and repeated student rows without applying them", () => {
    const twins = [...students, { ...students[0], id: "twin" }, { ...students[1], id: "foreign", name: "外班学生", classId: "other" }];
    const rows = parseExamPaste("张瑶,80\n外班学生,90\n不存在,50\n李亦琳,60\n李亦琳,70", twins, exam());
    expect(rows[0].errors.join()).toContain("同名");
    expect(rows[1].errors.join()).toContain("本班");
    expect(rows[2].errors.join()).toContain("未找到");
    expect(rows[3].errors.join()).toContain("重复");
    expect(rows[4].errors.join()).toContain("重复");
    expect(rows.every((row) => !row.entry)).toBe(true);
  });

  it.each([
    ["张瑶,151,150", "超过满分"], ["张瑶,-1,150", "非负数字"], ["张瑶,NaN,150", "非负数字"],
    ["张瑶,1e2,150", "非负数字"], ["张瑶,80%,100", "非负数字"], ["张瑶,80,0", "满分须"],
    ["张瑶,80,1001", "满分须"], ["张瑶,80,Infinity", "满分须"], ["张瑶 80", "分列粘贴"],
    ["张瑶,80,100,多余", "列数过多"], ['"张瑶,80', "双引号未闭合"],
  ])("explains the invalid row %s", (text, expected) => {
    const row = parseExamPaste(text, students, exam())[0];
    expect(row.errors.join()).toContain(expected);
    expect(row.entry).toBeUndefined();
  });

  it("rejects malformed or duplicate headers and returns no rows for empty input", () => {
    expect(parseExamPaste("姓名,姓名\n张瑶,80", students, exam())[0].errors.join()).toContain("表头");
    expect(parseExamPaste("姓名,学校\n张瑶,80", students, exam())[0].errors.join()).toContain("表头");
    expect(parseExamPaste("姓名,constructor,成绩\n张瑶,100,80", students, exam())[0].errors.join()).toContain("表头");
    expect(parseExamPaste(" \n ", students, exam())).toEqual([]);
    expect(parseExamPaste("姓名,成绩,满分", students, exam())).toEqual([]);
  });

  it("preserves quoted commas in names and physical line numbers", () => {
    const special = { ...students[0], name: '测试,"甲"' };
    const rows = parseExamPaste('\n"测试,""甲""",88\n', [special], exam());
    expect(rows[0]).toMatchObject({ line: 2, name: '测试,"甲"', errors: [], entry: { score: 88 } });
  });
});

describe("exam CSV export", () => {
  it("preserves unicode, raw scores and absences with BOM and quoted fields", () => {
    const text = exportExamCsv(exam([entry(0, 0), entry(1, 127.5, 150), entry(2, null, 100, "absent")]), students);
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text).toContain('"张瑶","一中","0","100","0","已录入"');
    expect(text).toContain('"李亦琳","一中","127.5","150","85","已录入"');
    expect(text).toContain('"陈测试","二中","","100","","缺考"');
    expect(text).toContain("\r\n");
  });

  it("neutralizes spreadsheet formula prefixes without dropping ordinary punctuation", () => {
    const value = exam([{ ...entry(0, 80), school: ' =HYPERLINK("bad")' }], { name: "+SUM(1,1)", subject: "@数学" });
    const text = exportExamCsv(value, [{ ...students[0], name: "-测试" }]);
    expect(text).toContain('"\'+SUM(1,1)"');
    expect(text).toContain('"\'@数学"');
    expect(text).toContain('"\'-测试"');
    expect(text).toContain('"\' =HYPERLINK(""bad"")"');
  });
});
