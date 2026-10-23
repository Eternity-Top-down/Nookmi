import type { ChangeEvent, ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import FeedbackRegenerationControls, {
  regenerationCandidates,
  selectedRegenerationTargets,
  type FeedbackRegenerationControlsProps,
} from "./FeedbackRegenerationControls";
import { emptyObservations } from "./feedbackModel";
import { EMPTY_STUDENT, type FeedbackEntry, type Student } from "./types";

const now = "2026-10-23T10:00:00.000Z";
const students: Student[] = ["甲同学", "乙同学", "丙同学", "丁同学"].map((name, index) => ({
  ...EMPTY_STUDENT, id: `student-${index}`, name, grade: "初二", module: "evening",
  classId: "class-1", createdAt: now, updatedAt: now,
}));
const entries: FeedbackEntry[] = students.map((student, index) => ({
  studentId: student.id,
  content: index === 2 ? "  " : `${student.name}已有正文`,
  observations: { ...emptyObservations(), performance: index === 3 ? "  " : "能独立完成基础题" },
}));

function props(overrides: Partial<FeedbackRegenerationControlsProps> = {}): FeedbackRegenerationControlsProps {
  return { students, entries, selectedIds: [], onSelectionChange: vi.fn(), onRegenerate: vi.fn(), busy: false, ...overrides };
}

function render(overrides: Partial<FeedbackRegenerationControlsProps> = {}) {
  return renderToStaticMarkup(<FeedbackRegenerationControls {...props(overrides)} />);
}

function checkbox(tree: ReactNode): ReactElement<{
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  ref: (element: HTMLInputElement) => void;
}> | undefined {
  if (!tree || typeof tree !== "object" || !("type" in tree)) return undefined;
  const element = tree as ReactElement<{ children?: ReactNode }>;
  if (element.type === "input") return element as ReturnType<typeof checkbox>;
  for (const child of [element.props.children].flat()) {
    const found = checkbox(child);
    if (found) return found;
  }
  return undefined;
}

describe("batch feedback regeneration selection", () => {
  it("only allows existing text backed by personal facts, preserving roster order", () => {
    const original = structuredClone(entries);
    expect(regenerationCandidates(students, [...entries].reverse())).toEqual(students.slice(0, 2));
    expect(entries).toEqual(original);
    expect(regenerationCandidates([students[1], students[0], students[1]], entries)).toEqual([students[1], students[0]]);
  });

  it("does not treat suggestions, tasks, or absent observations as real student facts", () => {
    const withoutFacts: FeedbackEntry[] = [
      { studentId: students[0].id, content: "旧反馈" },
      { studentId: students[1].id, content: "旧反馈", observations: { ...emptyObservations(), plan: "复习", tasks: "订正" } },
    ];
    expect(regenerationCandidates(students, withoutFacts)).toEqual([]);
    expect(regenerationCandidates(students, [{ ...withoutFacts[1], observations: { ...emptyObservations(), subjects: { 数学: "分类讨论遗漏等号" } } }])).toEqual([students[1]]);
  });

  it("ignores stale, duplicate, unselected and ineligible ids when selecting targets", () => {
    expect(selectedRegenerationTargets(students, entries, [students[1].id, "deleted", students[0].id, students[1].id, students[2].id, students[3].id]))
      .toEqual(students.slice(0, 2));
    expect(selectedRegenerationTargets(students, entries, [students[1].id])).toEqual([students[1]]);
    expect(selectedRegenerationTargets(students, entries, [])).toEqual([]);
  });

  it("selects only eligible students in one action, and clears the selection when unchecked", () => {
    const values = props({ selectedIds: ["deleted", students[0].id] });
    const input = checkbox(FeedbackRegenerationControls(values))!;
    input.props.onChange({ target: { checked: true } } as ChangeEvent<HTMLInputElement>);
    expect(values.onSelectionChange).toHaveBeenLastCalledWith([students[0].id, students[1].id]);
    input.props.onChange({ target: { checked: false } } as ChangeEvent<HTMLInputElement>);
    expect(values.onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it("renders a partial selection with native indeterminate and accessible mixed state", () => {
    const values = props({ selectedIds: [students[0].id] });
    const html = renderToStaticMarkup(<FeedbackRegenerationControls {...values} />);
    expect(html).toContain('aria-checked="mixed"');
    expect(html).not.toContain('checked=""');
    expect(html).toContain("已选 1 人");
    expect(html).toContain("重新生成已选（1 人）");
    const native = { indeterminate: false } as HTMLInputElement;
    checkbox(FeedbackRegenerationControls(values))!.props.ref(native);
    expect(native.indeterminate).toBe(true);
  });

  it("shows all selected only when every eligible student is selected", () => {
    const html = render({ selectedIds: [students[0].id, students[1].id, "deleted"] });
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('checked=""');
    expect(html).toContain("已选 2 人");
  });

  it("disables the run button when no valid students are selected", () => {
    const html = render({ selectedIds: ["deleted", students[2].id, students[3].id] });
    expect(html).toMatch(/<button\b[^>]*disabled=""/);
    expect(html).toContain("已选 0 人");
    expect(html).toContain("新结果成功后替换正文，失败时保留原文；重新生成后需再次核对。");
  });

  it("disables selection and generation during work", () => {
    const values = props({ selectedIds: [students[0].id], busy: true });
    const html = renderToStaticMarkup(<FeedbackRegenerationControls {...values} />);
    expect(html).toMatch(/<input\b[^>]*disabled=""/);
    expect(html).toMatch(/<button\b[^>]*disabled=""/);
    checkbox(FeedbackRegenerationControls(values))!.props.onChange({ target: { checked: true } } as ChangeEvent<HTMLInputElement>);
    expect(values.onSelectionChange).not.toHaveBeenCalled();
  });

  it("explains missing facts only for students with existing feedback", () => {
    expect(render()).toContain("1 人缺少真实记录，补充后可重新生成");
    expect(render({ students: students.slice(0, 3) })).not.toContain("缺少真实记录");
    const html = render({ students: [students[3]] });
    expect(html).toMatch(/<input\b[^>]*disabled=""/);
    expect(html).toContain('aria-checked="false"');
  });

  it("hides actions entirely for a read-only feedback view", () => {
    expect(render({ readonly: true })).toBe("");
  });
});
