import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  getWorkspace,
  putWorkspace,
  saveAISettings,
  generateFeedback,
} from "./api";
import { EMPTY_DATA } from "./data";

afterEach(() => vi.unstubAllGlobals());

describe("Python API boundary", () => {
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
