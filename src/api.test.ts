import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  getWorkspace,
  putWorkspace,
  saveAISettings,
  generateFeedback,
  suggestFeedback,
  parseFeedbackSuggestions,
} from "./api";
import { EMPTY_DATA } from "./data";
import { defaultBrief, emptyObservations } from "./feedbackModel";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Python API boundary", () => {
  it("sends only the reference supplied for each module and preserves its original text", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ content: "生成结果", model: "test" }),
      { headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const references = [
      { module: "one-to-one" as const, styleReference: "  单次课参考。\n练习建议具体。  " },
      { module: "evening" as const, styleReference: "晚辅一周参考。" },
      { module: "course" as const, styleReference: "班课月度参考。" },
    ];
    for (const reference of references) {
      await generateFeedback({
        ...reference, grade: "初二",
        brief: defaultBrief(reference.module, ["初二"], new Date(2026, 9, 21)),
        observations: { ...emptyObservations(), performance: "能说明计算过程" },
      });
    }
    const bodies = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(bodies.map(({ module, styleReference }) => ({ module, styleReference }))).toEqual(references);
    expect(fetchMock.mock.calls.every(([path]) => path === "/api/ai/generate")).toBe(true);
  });

  it("keeps styleReference optional and passes an explicit cleared reference as an empty string", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ content: "生成结果", model: "test" }),
      { headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const request = {
      module: "one-to-one" as const, grade: "初二",
      brief: defaultBrief("one-to-one", ["初二"], new Date(2026, 9, 21)),
      observations: { ...emptyObservations(), performance: "能说明计算过程" },
    };
    await generateFeedback(request);
    await generateFeedback({ ...request, styleReference: "" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("styleReference");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toHaveProperty("styleReference", "");
  });

  it("includes the loaded revision when saving and reads the committed revision", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: EMPTY_DATA, revision: 5 }), {
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect((await putWorkspace(EMPTY_DATA, 4)).revision).toBe(5);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      data: EMPTY_DATA,
      revision: 4,
    });
  });

  it("exposes a write conflict instead of reporting a successful save", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ detail: "资料已更新，请重新读取。" }), {
            status: 409,
            headers: { "content-type": "application/json" },
          }),
        ),
    );
    await expect(putWorkspace(EMPTY_DATA, 1)).rejects.toMatchObject({
      status: 409,
      message: "资料已更新，请重新读取。",
    });
  });

  it("treats an HTML proxy error as backend unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>oops</html>", {
            status: 502,
            headers: { "content-type": "text/html" },
          }),
        ),
    );
    await expect(getWorkspace()).rejects.toBeInstanceOf(ApiError);
  });

  it("does not resend a stored key when settings omit it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ configured: true }), {
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await saveAISettings({ baseUrl: "https://example.com/v1", model: "test" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty(
      "apiKey",
    );
  });

  it("preserves caller cancellation as an abort instead of a server failure", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")),
    );
    await expect(
      generateFeedback(
        {
          module: "one-to-one",
          grade: "初二",
          brief: {
            periodStart: "2026-10-21",
            periodEnd: "2026-10-21",
            subjects: ["数学"],
            teachingContent: "几何证明",
            commonTasks: "",
            focus: "",
            length: "standard",
          },
          observations: {
            performance: "主动说明思路",
            strengths: "",
            difficulties: "",
            plan: "",
            tasks: "",
            subjects: {},
          },
        },
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("AI observation suggestion API", () => {
  const input = {
    module: "evening" as const,
    grade: "初二",
    brief: defaultBrief("evening", ["初二"], new Date(2026, 9, 21)),
    observations: { ...emptyObservations(), performance: "能独立列出方程" },
    styleReference: "  我的晚辅参考风格  ",
  };

  it("posts the current module facts and style without sending student identity properties", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ suggestions: [{ field: "plan", text: "  建议检查变号步骤。  " }] }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const accidentalExtraFields = { ...input, studentName: "不应发送的姓名", studentId: "student-private" };
    await expect(suggestFeedback(accidentalExtraFields)).resolves.toEqual({ suggestions: [{ field: "plan", text: "建议检查变号步骤。" }] });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ai/suggestions");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(input);
  });

  it("shows the backend's setup error without substituting fabricated suggestions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "请先配置 AI 服务。" }), { status: 503, headers: { "content-type": "application/json" } })));
    await expect(suggestFeedback(input)).rejects.toMatchObject({ status: 503, message: "请先配置 AI 服务。" });
  });

  it("aborts an active recommendation request when the caller cancels", async () => {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_, options: RequestInit) => new Promise((_, reject) => {
      signal = options.signal as AbortSignal;
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const pending = expect(suggestFeedback(input, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await pending;
    expect(signal?.aborted).toBe(true);
  });

  it("allows a model request 95 seconds and then gives a recoverable timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((_, options: RequestInit) => new Promise((_, reject) => {
      signal = options.signal as AbortSignal;
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })));
    const pending = expect(suggestFeedback(input)).rejects.toMatchObject({ status: 0, message: expect.stringContaining("超时") });
    await vi.advanceTimersByTimeAsync(94999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(signal?.aborted).toBe(true);
  });

  it("rejects malformed successful responses before they can enter the component", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ suggestions: [{ field: "constructor", text: "不合法分类" }] }), { headers: { "content-type": "application/json" } })));
    await expect(suggestFeedback(input)).rejects.toMatchObject({ status: 502, message: expect.stringContaining("格式不正确") });
  });

  it.each([
    null, [], {}, { suggestions: null }, { suggestions: "x" },
    { suggestions: [null] }, { suggestions: ["x"] },
    { suggestions: [{ field: "tasks", text: "不支持的分类" }] },
    { suggestions: [{ field: "plan", text: null }] },
    { suggestions: [{ field: "plan", text: "   " }] },
    { suggestions: [{ field: "plan", text: "字".repeat(241) }] },
    { suggestions: Array.from({ length: 7 }, () => ({ field: "plan", text: "建议" })) },
  ])("rejects invalid suggestion data %#", (value) => {
    expect(() => parseFeedbackSuggestions(value)).toThrow(ApiError);
  });

  it("accepts zero through six valid suggestions and preserves text as plain text", () => {
    expect(parseFeedbackSuggestions({ suggestions: [] })).toEqual([]);
    const valid = { suggestions: Array.from({ length: 6 }, () => ({ field: "plan", text: "<script>这是普通文本</script>" })) };
    expect(parseFeedbackSuggestions(valid)).toEqual(valid.suggestions);
    expect(parseFeedbackSuggestions({ suggestions: [{ field: "strengths", text: "字".repeat(240) }] })[0].text).toHaveLength(240);
  });
});
