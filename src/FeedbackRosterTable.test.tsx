import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FeedbackRosterTable from "./FeedbackRosterTable";
import { emptyObservations } from "./feedbackModel";
import { EMPTY_STUDENT, type FeedbackEntry, type Student } from "./types";

const now = "2026-10-21T10:00:00.000Z";
const students: Student[] = ["甲同学", "乙同学"].map((name, index) => ({
  ...EMPTY_STUDENT, id: `student-${index}`, name, grade: "初二", module: "evening",
  classId: "class-1", createdAt: now, updatedAt: now,
}));
const makeEntries = (): FeedbackEntry[] => students.map((student, index) => ({
  studentId: student.id, content: index === 0 ? "已有完整正文" : "",
  observations: { ...emptyObservations(), performance: `${student.name}的独立观察` },
}));
function render(overrides: Partial<ComponentProps<typeof FeedbackRosterTable>> = {}) {
  return renderToStaticMarkup(<FeedbackRosterTable
    module="evening" students={students} entries={makeEntries()} subjects={["数学", "物理"]}
    readonly={false} failures={new Map()} staleIds={new Set()}
    onObservationChange={() => undefined} onSubjectChange={() => undefined}
    onViewResult={() => undefined} {...overrides}
  />);
}
function rowFor(html: string, name: string) {
  return [...html.matchAll(/<tr\b[^>]*aria-label="([^"]+)的反馈记录"[^>]*>([\s\S]*?)<\/tr>/g)]
    .find((match) => match[1] === name)?.[2];
}

describe("feedback roster table", () => {
  it("keeps selected and saved evening subject notes in separate student cells", () => {
    const entries = makeEntries();
    entries[0].observations!.subjects = { 数学: "数学能独立完成", 化学: "旧化学记录保留" };
    entries[1].observations!.subjects = { 物理: "电路图需要提示", 生物: "  " };
    const before = structuredClone(entries);
    const html = render({ entries, subjects: ["数学", "物理", "数学"] });
    const first = rowFor(html, "甲同学")!;
    const second = rowFor(html, "乙同学")!;
    for (const subject of ["数学", "物理", "化学"]) {
      expect(first.match(new RegExp(`aria-label="甲同学的${subject}记录"`, "g"))).toHaveLength(1);
      expect(second.match(new RegExp(`aria-label="乙同学的${subject}记录"`, "g"))).toHaveLength(1);
    }
    expect(html).not.toContain("生物记录");
    expect(first).toContain("旧化学记录保留");
    expect(first).not.toContain("电路图需要提示");
    expect(second).toContain("电路图需要提示");
    expect(second).not.toContain("旧化学记录保留");
    expect(entries).toEqual(before);
  });

  it("only offers result navigation for rows with feedback without hash links", () => {
    const html = render();
    expect(rowFor(html, "甲同学")).toMatch(/<button\b[^>]*aria-label="查看甲同学的反馈结果"/);
    expect(rowFor(html, "乙同学")).not.toContain("查看乙同学的反馈结果");
    expect(html).not.toContain('href="#');
    expect(html).not.toContain("已有完整正文");
  });

  it("keeps supplements collapsed but clearly signals saved optional fields", () => {
    const entries = makeEntries();
    entries[0].observations = { ...emptyObservations(), strengths: "认真订正", difficulties: "边界遗漏", plan: "整理边界条件", tasks: "订正两题", subjects: { 数学: "历史分科观察" } };
    const before = structuredClone(entries);
    const html = render({ module: "course", entries });
    const row = rowFor(html, "甲同学")!;
    expect(row).toContain('aria-label="甲同学的补充记录"');
    expect(row).toContain('aria-expanded="false"');
    expect(row).toContain("补充 (5)");
    expect(row).not.toContain("历史分科观察");
    expect(row).toContain("待核对");
    expect(entries).toEqual(before);
  });

  it("makes every visible cell read only without hiding saved records", () => {
    const html = render({ readonly: true });
    const cells = [...html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g)];
    expect(cells).toHaveLength(6);
    for (const cell of cells) {
      expect(cell[1]).toContain('readOnly=""');
      expect(cell[1]).not.toContain('required=""');
    }
    expect(rowFor(html, "甲同学")).toContain("甲同学的独立观察");
    expect(rowFor(html, "乙同学")).toContain("乙同学的独立观察");
  });

  it("distinguishes stale, failed, generating and reviewed rows", () => {
    const entries = makeEntries();
    entries[0].reviewed = true;
    expect(rowFor(render({ entries }), "甲同学")).toContain("已核对");
    const stale = render({ entries, staleIds: new Set(["student-0"]) });
    expect(rowFor(stale, "甲同学")).toContain("记录已更新");
    expect(rowFor(stale, "乙同学")).not.toContain("记录已更新");
    const failed = render({ failures: new Map([["student-1", "服务暂不可用"]]) });
    expect(rowFor(failed, "乙同学")).toContain("待重试");
    expect(rowFor(failed, "乙同学")).toContain("服务暂不可用");
    expect(rowFor(render({ generatingStudentId: "student-1" }), "乙同学")).toContain("正在生成");
  });

  it("does not count plans or tasks as facts and omits students outside the current roster", () => {
    const entries = makeEntries();
    entries[1].observations = { ...emptyObservations(), plan: "明天复习", tasks: "补充练习" };
    entries.push({ studentId: "removed", content: "已移除学生的正文", observations: { ...emptyObservations(), subjects: { 地理: "已移除学生的记录" } } });
    const html = render({ entries });
    expect(rowFor(html, "乙同学")).toContain("待记录");
    expect(rowFor(html, "乙同学")).not.toContain("待生成");
    expect(html).not.toContain("已移除学生");
    expect(html).not.toContain("地理记录");
  });
});
