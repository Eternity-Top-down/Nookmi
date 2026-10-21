import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import ExamWorkspace from "./ExamWorkspace";
import { examToEditor, writeExamDraft } from "./examDrafts";
import { EMPTY_STUDENT, type ClassGroup, type Exam, type Student } from "./types";

const now = "2026-10-21T08:00:00.000Z";
const group: ClassGroup = { id: "class-1", module: "course", name: "数学班", grade: "高一", schedule: "", notes: "", createdAt: now };
const students: Student[] = ["甲同学", "乙同学", "丙同学", "丁同学", "戊同学", "己同学"].map((name, index) => ({
  ...EMPTY_STUDENT, id: `student-${index}`, name, school: "现档案学校", module: "course", classId: group.id, createdAt: now, updatedAt: now,
}));
const exam = (): Exam => ({
  id: "exam-current", classId: group.id, name: "第一次月考", subject: "数学", date: "2026-10-21", defaultMaxScore: 150,
  createdAt: now, updatedAt: now,
  entries: [
    { studentId: "student-0", school: "一中", maxScore: 100, score: 0, status: "recorded" },
    { studentId: "student-1", school: "一中", maxScore: 100, score: 60, status: "recorded" },
    { studentId: "student-2", school: "二中", maxScore: 120, score: 102, status: "recorded" },
    { studentId: "student-3", school: "三中", maxScore: 150, score: 150, status: "recorded" },
    { studentId: "student-4", school: "一中", maxScore: 100, score: null, status: "pending" },
    { studentId: "student-5", school: "二中", maxScore: 120, score: null, status: "absent" },
  ],
});

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
});
afterEach(() => vi.unstubAllGlobals());

function render(exams = [exam()]) {
  return renderToStaticMarkup(<ExamWorkspace group={group} students={students} exams={exams}
    onSave={async () => true} onDelete={async () => true} autoSaveBlocked={false} onDirtyChange={() => undefined} />);
}
const text = (html: string) => html.replace(/<[^>]*>/g, "");
function metric(html: string, label: string) {
  const value = html.match(new RegExp(`<div><span>${label}</span><strong>([\\s\\S]*?)</strong><p>([\\s\\S]*?)</p></div>`));
  expect(value, `missing metric ${label}`).toBeTruthy();
  return { value: text(value![1]), note: text(value![2]) };
}
const entryRows = (html: string) => [...html.matchAll(/<tr><th scope="row">([\s\S]*?)<\/tr>/g)].map(match => match[1]);

describe("exam workspace initial rendering", () => {
  it("shows rates for mixed maxima and excludes absence/missing scores from the displayed denominator", () => {
    const html = render();
    expect(metric(html, "已录成绩")).toEqual({ value: "4 / 6 人", note: "未录 1 · 缺考 1" });
    expect(metric(html, "平均得分率").value).toBe("61.3%");
    expect(metric(html, "得分率中位数").value).toBe("72.5%");
    expect(metric(html, "平均分")).toEqual({ value: "—", note: "满分不同，请参考得分率" });
    expect(text(html)).toContain("达 60%：3 人（75%） · 达 85%：2 人（50%）");
  });

  it("shows a raw average only for a shared full mark without claiming equivalent papers", () => {
    const value = exam();
    value.entries = value.entries.map(entry => ({ ...entry, maxScore: 150 }));
    const html = render([value]);
    expect(metric(html, "平均分")).toEqual({ value: "78 / 150", note: "同满分成绩汇总，试卷可能不同" });
    expect(metric(html, "平均得分率").value).toBe("52%");
  });

  it("retains roster order and each student's original score, maximum and school instead of ranking", () => {
    const value = exam();
    const before = structuredClone(value);
    const html = render([value]);
    const rows = entryRows(html);
    expect(rows).toHaveLength(students.length);
    rows.forEach((row, index) => {
      const entry = value.entries[index];
      expect(row).toContain(`<strong>${students[index].name}</strong>`);
      expect(row).toContain(`aria-label="${students[index].name}的考试学校"`);
      expect(row).toContain(`value="${entry.school}"`);
      expect(row).toContain(`aria-label="${students[index].name}的满分"`);
      expect(row).toContain(`value="${entry.maxScore}"`);
      expect(row).not.toContain('value="现档案学校"');
    });
    expect(rows[0]).toMatch(/aria-label="甲同学的成绩"[^>]*value="0"/);
    expect(rows[4]).toMatch(/aria-label="戊同学的成绩"[^>]*value=""/);
    expect(rows[5]).toMatch(/aria-label="己同学的成绩"[^>]*disabled=""[^>]*value=""/);
    expect(html).not.toMatch(/<th[^>]*>(排名|名次)<\/th>/);
    expect(value).toEqual(before);
  });

  it("compares percentages with the previous same-subject exam, never raw score differences", () => {
    const current = exam();
    const prior: Exam = { ...exam(), id: "exam-prior", name: "入学摸底", date: "2026-09-01", entries: exam().entries.map(entry => ({ ...entry, maxScore: 120 })) };
    prior.entries[1].score = 60;
    prior.entries[3].score = null; prior.entries[3].status = "absent";
    const otherSubject: Exam = { ...prior, id: "physics", subject: "物理", date: "2026-10-20", name: "物理期中" };
    const html = render([current, otherSubject, prior]);
    expect(text(html)).toContain("对照上次：入学摸底（2026-09-01）");
    const rows = entryRows(html);
    expect(text(rows[1])).toContain("+10 个百分点上次 60/120");
    expect(text(rows[3])).toContain("—无有效对照");
    expect(html).not.toContain("对照上次：物理期中");
  });

  it("keeps invalid draft input visible but excludes it from statistics and prevents exporting it", () => {
    const editor = examToEditor(exam());
    editor.entries[1].score = "110";
    writeExamDraft({ editor, baseUpdatedAt: now });
    const html = render();
    expect(metric(html, "已录成绩")).toEqual({ value: "3 / 6 人", note: "未录 1 · 缺考 1 · 1 处待修正" });
    expect(metric(html, "平均得分率").value).toBe("61.7%");
    expect(entryRows(html)[1]).toMatch(/aria-invalid="true"[^>]*value="110"/);
    expect(entryRows(html)[1]).toContain("成绩须为 0–100 之间的数字");
    const exportButton = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].find(match => text(match[0]) === "导出成绩")?.[0];
    expect(exportButton).toMatch(/^<button[^>]*disabled=""/);
  });

  it("provides explicit empty states rather than zero averages or a fabricated trend", () => {
    const value = exam();
    value.entries = value.entries.map(entry => ({ ...entry, status: "pending", score: null }));
    const html = render([value]);
    expect(metric(html, "平均得分率").value).toBe("—");
    expect(metric(html, "平均分").value).toBe("—");
    expect(html).not.toContain('<svg class="exam-trend-chart"');
    expect(text(html)).toContain("再录入一次数学考试，就能看到连续变化");
    expect(text(render([]))).toContain("创建考试后，全班名单会自动带入");
  });
});
