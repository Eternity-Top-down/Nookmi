import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  getWorkspace,
  putWorkspace,
  saveAISettings,
  generateFeedback,
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
