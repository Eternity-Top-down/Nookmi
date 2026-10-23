import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultFeedbackWordTitle, feedbackWordPeriodLabel } from "./feedbackWordTitle";
import type { FeedbackSession } from "./types";

function session(start: string, end = start): FeedbackSession {
  return {
    id: "session", module: "evening", classId: "class", studentId: null,
    lessonAt: "2026-10-21T18:00", createdAt: "2026-10-21T10:00:00.000Z", updatedAt: "2026-10-21T10:00:00.000Z",
    entries: [],
    brief: { periodStart: start, periodEnd: end, subjects: ["数学"], teachingContent: "", commonTasks: "", focus: "", length: "standard" },
  };
}

afterEach(() => vi.useRealTimers());

describe("Word feedback title dates", () => {
  it.each([
    ["2026-10-19", "2026-10-23", "2026年10月第4周"],
    ["2026-10-25", "2026-10-26", "2026年10月第4—5周"],
    ["2026-10-01", "2026-10-31", "2026年10月第1—5周"],
    ["2026-10-26", "2026-11-01", "2026年10月第5周—11月第1周"],
    ["2026-12-28", "2027-01-03", "2026年12月第5周—2027年1月第1周"],
    ["2026-06-01", "2026-06-07", "2026年6月第1周"],
    ["2026-06-08", "2026-06-14", "2026年6月第2周"],
    ["2026-02-01", "2026-02-02", "2026年2月第1—2周"],
    ["2026-08-31", "2026-08-31", "2026年8月第6周"],
    ["2028-02-29", "2028-02-29", "2028年2月第5周"],
  ])("labels %s through %s as %s", (start, end, expected) => {
    expect(feedbackWordPeriodLabel(session(start, end))).toBe(expected);
  });

  it("uses the feedback period, not the export day or session update date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-03-01T23:30:00.000Z"));
    const old = session("2026-10-19", "2026-10-23");
    old.updatedAt = "2030-03-01T23:30:00.000Z";
    expect(defaultFeedbackWordTitle(old, " 初三班 ")).toBe("初三班 2026年10月第4周 晚辅反馈");
    expect(defaultFeedbackWordTitle({ ...old, module: "course" }, "高一班")).toBe("高一班 2026年10月第4周 班课反馈");
  });

  it("uses the original lesson date for legacy feedback without a brief", () => {
    const legacy = session("", "");
    delete legacy.brief;
    expect(defaultFeedbackWordTitle(legacy)).toBe("2026年10月第4周 晚辅反馈");
  });

  it("uses the available date while a period field is empty or invalid", () => {
    expect(feedbackWordPeriodLabel(session("", "2026-11-02"))).toBe("2026年11月第2周");
    expect(feedbackWordPeriodLabel(session("2026-11-02", ""))).toBe("2026年11月第2周");
    expect(feedbackWordPeriodLabel(session("2026-02-29", "2026-13-01"))).toBe("2026年10月第4周");
  });

  it("never invents today's period when all stored dates are invalid", () => {
    const invalid = { ...session("", ""), lessonAt: "" };
    expect(defaultFeedbackWordTitle(invalid, "初二班")).toBe("初二班 晚辅反馈");
  });
});
