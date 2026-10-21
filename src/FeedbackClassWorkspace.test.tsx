import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FeedbackWorkspace from "./FeedbackWorkspace";
import FeedbackHistory from "./FeedbackHistory";
import { defaultBrief, emptyObservations, generationSignature } from "./feedbackModel";
import { EMPTY_STUDENT, type FeedbackSession, type ModuleId, type Student } from "./types";

const now = "2026-10-21T10:00:00.000Z";
function fixture(module: ModuleId) {
  const students: Student[] = ["甲同学", "乙同学", "丙同学", "丁同学"].map((name, index) => ({
    ...EMPTY_STUDENT, id: `student-${index}`, name, grade: "初二", module, classId: "class-1", createdAt: now, updatedAt: now,
  }));
  const brief = { ...defaultBrief(module, ["初二"], new Date(2026, 9, 21)), teachingContent: "全班共同学习二次函数" };
  const session: FeedbackSession = { id: "class-feedback", module, classId: "class-1", studentId: null,
    lessonAt: `${brief.periodStart}T00:00`, brief, createdAt: now, updatedAt: now,
    entries: students.map((student, index) => ({ studentId: student.id, content: index === 0 ? "甲的已核对正文" : "",
      observations: { ...emptyObservations(), performance: index < 3 ? `${student.name}的专属观察` : "",
        tasks: index === 3 ? "只有未来安排，不属于事实" : "" }, reviewed: index === 0 })),
  };
  return { students, session };
}
const render = (module: ModuleId, students: Student[], session: FeedbackSession) => renderToStaticMarkup(<FeedbackWorkspace
  module={module} students={students} classId="class-1" studentId={null} sessions={[session]} onSave={async () => true} />);
const noteRows = (html: string) => [...html.matchAll(/<tr\b[^>]*aria-label="([^"]+)的反馈记录"[^>]*>([\s\S]*?)<\/tr>/g)];
const results = (html: string) => [...html.matchAll(/<article\b[^>]*aria-label="([^"]+)的反馈结果"[^>]*>([\s\S]*?)<\/article>/g)];
function buttonWithText(html: string, text: string) {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .find((match) => match[2].replace(/<[^>]*>/g, "").includes(text));
}

describe("full-class feedback workspace", () => {
  it.each(["evening", "course"] as const)("puts every %s student's notes in one table and keeps long feedback outside it", (module) => {
    const { students, session } = fixture(module);
    const before = structuredClone(session);
    const html = render(module, students, session);
    const table = /<table\b[^>]*>([\s\S]*?)<\/table>/.exec(html)?.[1];
    expect(table).toBeDefined();
    const rows = noteRows(table!);
    expect(rows.map((row) => row[1])).toEqual(students.map((student) => student.name));
    expect(table).toContain("<thead>");
    expect(table).toContain("<tbody>");
    expect(html).not.toContain('aria-label="选择反馈学生"');
    expect(html.match(/全班共同学习二次函数/g)).toHaveLength(1);
    expect(table).not.toContain("家长反馈正文");
    expect(table).not.toContain("甲的已核对正文");
    expect(html).toContain("甲的已核对正文");
    for (let index = 0; index < students.length; index++) {
      const row = rows[index][2];
      expect(row).toContain(`aria-label="${students[index].name}的学生情况"`);
      expect(row).not.toContain(' required=""');
      if (index < 3) expect(row).toContain(`${students[index].name}的专属观察`);
      for (const other of students.filter((student) => student.id !== students[index].id)) {
        expect(row).not.toContain(`${other.name}的专属观察`);
      }
    }
    const ids = [...html.matchAll(/<textarea[^>]+id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(students.length);
    expect(session).toEqual(before);
  });

  it("only offers batch generation for students with facts and no existing body", () => {
    const { students, session } = fixture("course");
    const html = render("course", students, session);
    expect(buttonWithText(html, "AI 批量生成（2 人）")).toBeDefined();
    expect(buttonWithText(html, "AI 批量生成（2 人）")?.[1]).not.toContain("disabled");
    const firstResult = results(html).find((result) => result[1] === students[0].name);
    expect(firstResult?.[2]).toContain("重新生成候选");
    expect(buttonWithText(html, "复制 甲同学 的反馈")).toBeDefined();
    expect(buttonWithText(html, "复制 甲同学 的反馈")?.[1]).not.toContain("disabled");
    expect(buttonWithText(html, "复制 乙同学 的反馈")?.[1]).toContain("disabled");
    const lastRow = noteRows(html)[3][2];
    expect(lastRow).not.toContain("待生成");
    expect(session.entries[3].observations?.tasks).toBe("只有未来安排，不属于事实");
  });

  it("marks a changed student's row and result without marking other students stale", () => {
    const { students, session } = fixture("course");
    for (const entry of session.entries.slice(0, 2)) {
      entry.content = `${entry.studentId}的生成正文`;
      entry.reviewed = false;
      entry.generationSource = "ai";
      entry.generatedFrom = generationSignature(session.module, session.brief!, entry.observations!, "初二", session.lessonAt);
    }
    session.entries[1].observations!.performance = "生成后新增的新观察";
    const html = render("course", students, session);
    const firstResult = results(html).find((result) => result[1] === students[0].name);
    const secondResult = results(html).find((result) => result[1] === students[1].name);
    expect(firstResult?.[2]).not.toContain("生成依据已更新");
    expect(secondResult?.[2]).toContain("生成依据已更新");
    const rows = noteRows(html);
    expect(rows[0][2]).not.toContain("记录已更新");
    expect(rows[1][2]).toContain("记录已更新");
    expect(rows[1][2]).toContain("生成后新增的新观察");
  });

  it("disables the batch action when everyone has feedback or only future arrangements", () => {
    const { students, session } = fixture("course");
    session.entries[1].content = "已手写的正文";
    session.entries[2].observations = { ...emptyObservations(), plan: "之后多练习", tasks: "完成练习" };
    const html = render("course", students, session);
    expect(buttonWithText(html, "AI 批量生成")?.[1]).toContain("disabled");
    expect(html).toContain("已手写的正文");
  });

  it("only shows historical delete controls when a confirmation callback is supplied", () => {
    const { students, session } = fixture("course");
    const withoutDelete = renderToStaticMarkup(<FeedbackHistory sessions={[session]} students={students} />);
    expect(withoutDelete).not.toContain("删除这次反馈");
    const withDelete = renderToStaticMarkup(<FeedbackHistory sessions={[session]} students={students} onDelete={() => undefined} />);
    expect(withDelete).toContain("删除这次反馈");
  });
});
