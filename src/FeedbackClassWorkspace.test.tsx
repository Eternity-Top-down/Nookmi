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
const cards = (html: string) => [...html.matchAll(/<article class="fb-student-card"[^>]*>([\s\S]*?)<\/article>/g)].map((match) => match[1]);

describe("full-class feedback workspace", () => {
  it.each(["evening", "course"] as const)("shows every %s student's real notes and body together without a selection sidebar", (module) => {
    const { students, session } = fixture(module);
    const before = structuredClone(session);
    const html = render(module, students, session);
    const studentCards = cards(html);
    expect(studentCards).toHaveLength(students.length);
    expect(html).not.toContain('aria-label="选择反馈学生"');
    expect(html.match(/全班共同学习二次函数/g)).toHaveLength(1);
    for (let index = 0; index < students.length; index++) {
      const card = studentCards[index];
      expect(card).toContain(`aria-label="${students[index].name}的学生情况"`);
      expect(card).toContain(`${students[index].name}的家长反馈正文`);
      expect(card).toContain(`复制 ${students[index].name} 的反馈`);
      expect(card).not.toContain(' required=""');
      if (index < 3) expect(card).toContain(`${students[index].name}的专属观察`);
      for (const other of students.filter((student) => student.id !== students[index].id)) {
        expect(card).not.toContain(`${other.name}的专属观察`);
      }
    }
    const ids = [...html.matchAll(/<textarea[^>]+id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(students.length);
    expect(session).toEqual(before);
  });

  it("only offers batch generation for students with facts and no existing body", () => {
    const { students, session } = fixture("course");
    const html = render("course", students, session);
    expect(html).toContain("生成未完成反馈（2）");
    const studentCards = cards(html);
    expect(studentCards[0]).toContain("重新生成候选");
    expect(studentCards[0]).toMatch(/<button[^>]*class="button button-secondary fb-copy-button"(?![^>]*disabled)/);
    expect(studentCards[1]).toMatch(/<button[^>]*class="button button-secondary fb-copy-button"[^>]*disabled/);
    expect(studentCards[3]).toMatch(/<button[^>]*class="button button-primary"[^>]*disabled/);
    expect(studentCards[3]).toContain("只有未来安排，不属于事实");
  });

  it("computes stale generation markers separately for each student card", () => {
    const { students, session } = fixture("course");
    for (const entry of session.entries.slice(0, 2)) {
      entry.content = `${entry.studentId}的生成正文`;
      entry.reviewed = false;
      entry.generationSource = "ai";
      entry.generatedFrom = generationSignature(session.module, session.brief!, entry.observations!, "初二", session.lessonAt);
    }
    session.entries[1].observations!.performance = "生成后新增的新观察";
    const studentCards = cards(render("course", students, session));
    expect(studentCards[0]).not.toContain("生成依据已更新");
    expect(studentCards[1]).toContain("生成依据已更新");
    expect(studentCards[1]).toContain("生成后新增的新观察");
  });

  it("only shows historical delete controls when a confirmation callback is supplied", () => {
    const { students, session } = fixture("course");
    const withoutDelete = renderToStaticMarkup(<FeedbackHistory sessions={[session]} students={students} />);
    expect(withoutDelete).not.toContain("删除这次反馈");
    const withDelete = renderToStaticMarkup(<FeedbackHistory sessions={[session]} students={students} onDelete={() => undefined} />);
    expect(withDelete).toContain("删除这次反馈");
  });
});
