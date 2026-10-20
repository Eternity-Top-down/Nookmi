import type {
  AppData,
  FeedbackBrief,
  ModuleId,
  StudentObservations,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  timeout = 15000,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: controller.signal,
    });
    if (!response.headers.get("content-type")?.includes("application/json")) {
      throw new ApiError(
        "后端没有返回有效数据，请确认 Python 服务已启动。",
        response.status,
      );
    }
    const body = await response.json();
    if (!response.ok) {
      const detail = body.detail ?? body.message;
      throw new ApiError(
        typeof detail === "string"
          ? detail
          : response.status === 422
            ? "输入格式不正确，请检查日期、内容长度和必填信息。"
            : "请求未完成，请稍后重试。",
        response.status,
      );
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (options.signal?.aborted)
      throw new DOMException("已取消生成", "AbortError");
    throw new ApiError(
      controller.signal.aborted
        ? "请求等待超时，已保留当前输入，请检查服务后重试。"
        : "无法连接本地后端，请启动 Python 服务后重试。当前输入不会被清空。",
      0,
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export interface WorkspaceResponse {
  data: AppData;
  revision: number;
}

export function getWorkspace() {
  return request<WorkspaceResponse>("/workspace");
}

export function putWorkspace(data: AppData, revision: number) {
  return request<WorkspaceResponse>("/workspace", {
    method: "PUT",
    body: JSON.stringify({ data, revision }),
  });
}

export interface AISettings {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  configured: boolean;
}

export function getAISettings() {
  return request<AISettings>("/ai/settings");
}

export function saveAISettings(
  settings: Pick<AISettings, "baseUrl" | "model"> & {
    apiKey?: string;
    clearApiKey?: boolean;
  },
) {
  return request<AISettings>("/ai/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export function testAIConnection() {
  return request<{ ok: boolean; message: string }>(
    "/ai/test",
    { method: "POST" },
    95000,
  );
}

export interface GenerateRequest {
  module: ModuleId;
  brief: FeedbackBrief;
  observations: StudentObservations;
  grade: string;
}

export function generateFeedback(input: GenerateRequest, signal?: AbortSignal) {
  return request<{ content: string; model: string }>(
    "/ai/generate",
    { method: "POST", body: JSON.stringify(input), signal },
    95000,
  );
}
