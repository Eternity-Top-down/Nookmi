import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import FeedbackWordExport from "./FeedbackWordExport";
import { feedbackWordSnapshot, requestFeedbackWord } from "./feedbackWordExportApi";
import { EMPTY_STUDENT, type FeedbackSession, type Student } from "./types";

const now = "2026-10-21T10:00:00.000Z";
const students: Student[] = ["示例甲", "示例乙", "示例丙"].map((name, index) => ({
  ...EMPTY_STUDENT, id: String(index), name, module: "evening", classId: "class-1", createdAt: now, updatedAt: now,
}));
const session: FeedbackSession = { id: "session", module: "evening", classId: "class-1", studentId: null,
  lessonAt: "2026-10-21T18:00", createdAt: now, updatedAt: now,
  entries: [{ studentId: "1", content: "  乙待核对正文\n第二行  ", reviewed: false },
    { studentId: "0", content: "甲已核对正文", reviewed: true }, { studentId: "2", content: " \n " },
    { studentId: "outside", content: "不属于当前名单" }],
};
const input = { title: "本周反馈", entries: [{ studentName: "示例甲", content: "正文" }] };

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Word feedback export", () => {
  it("captures all nonempty bodies in roster order, including unreviewed text, without changing the draft", () => {
    const before = structuredClone(session);
    const snapshot = feedbackWordSnapshot(session, [...students, students[0]]);
    expect(snapshot).toEqual({ entries: [{ studentName: "示例甲", content: "甲已核对正文" },
      { studentName: "示例乙", content: "乙待核对正文\n第二行" }], unreviewed: 1, skipped: 1 });
    expect(session).toEqual(before);
    expect(feedbackWordSnapshot(session, [students[1]]).entries).toHaveLength(1);
  });

  it("hides one-to-one export and disables group export without bodies", () => {
    expect(renderToStaticMarkup(<FeedbackWordExport session={{ ...session, module: "one-to-one" }} students={students} />)).toBe("");
    expect(renderToStaticMarkup(<FeedbackWordExport session={{ ...session, entries: [] }} students={students} />)).toContain('disabled=""');
    const html = renderToStaticMarkup(<FeedbackWordExport session={session} students={students} />);
    expect(html).toContain("导出 Word");
    expect(html).not.toContain('disabled=""');
  });

  it.each(["本周反馈", "初二班 2026年10月第4周 晚辅反馈", "老师手写的标题，保持原样"])("requests a Word file without rewriting its supplied title: %s", async (title) => {
    const customInput = { ...input, title };
    const fetchMock = vi.fn().mockResolvedValue(new Response("word-bytes", { headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="feedback.docx"; filename*=UTF-8''${encodeURIComponent("本周反馈.docx")}`,
    } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await requestFeedbackWord(customInput);
    expect(result.filename).toBe("本周反馈.docx");
    expect(await result.blob.text()).toBe("word-bytes");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/exports/feedback-docx");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(customInput);
  });

  it.each([
    [404, { detail: "Not Found" }, "重新启动"],
    [422, { detail: "文档标题不能为空" }, "文档标题不能为空"],
  ])("reports actionable API errors for status %i", async (status, body, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
    await expect(requestFeedbackWord(input)).rejects.toThrow(message);
  });

  it("rejects HTML fallback instead of downloading a broken document", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>app</html>", { headers: { "content-type": "text/html" } })));
    await expect(requestFeedbackWord(input)).rejects.toThrow("没有返回 Word");
  });

  it("keeps a network failure actionable without clearing the source snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(requestFeedbackWord(input)).rejects.toThrow("当前反馈不会改变");
    expect(input.entries[0].content).toBe("正文");
  });
});
