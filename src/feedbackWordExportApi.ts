import { ApiError } from "./api";
import type { FeedbackSession, Student } from "./types";

export interface FeedbackWordInput {
  title: string;
  entries: { studentName: string; content: string }[];
}
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Capture only visible roster members, in roster order, including unreviewed bodies. */
export function feedbackWordSnapshot(session: FeedbackSession, students: Student[]) {
  const seen = new Set<string>();
  const roster = students.filter((student) => {
    if (seen.has(student.id)) return false;
    seen.add(student.id);
    return true;
  });
  let unreviewed = 0;
  const entries = roster.flatMap((student) => {
    const entry = session.entries.find((item) => item.studentId === student.id);
    if (!entry?.content.trim()) return [];
    if (!entry.reviewed) unreviewed += 1;
    return [{ studentName: student.name, content: entry.content.trim() }];
  });
  return { entries, unreviewed, skipped: roster.length - entries.length };
}

function safeFilename(disposition: string | null): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? "")?.[1];
  try {
    const name = encoded ? decodeURIComponent(encoded) : "反馈汇总.docx";
    return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").trim() || "反馈汇总.docx";
  } catch {
    return "反馈汇总.docx";
  }
}

export async function requestFeedbackWord(input: FeedbackWordInput, signal?: AbortSignal): Promise<{ blob: Blob; filename: string }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 30000);
  try {
    const response = await fetch("/api/exports/feedback-docx", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input), signal: controller.signal,
    });
    if (!response.ok) {
      let detail = "Word 导出失败，请稍后重试。";
      if (response.headers.get("content-type")?.includes("application/json")) {
        const body = await response.json();
        if (typeof body.detail === "string") detail = body.detail;
      }
      if (response.status === 404) detail = "当前后端尚未支持 Word 导出，请重新启动 Nookmi 后重试。";
      throw new ApiError(detail, response.status);
    }
    if (!response.headers.get("content-type")?.includes(DOCX_TYPE)) {
      throw new ApiError("后端没有返回 Word 文档，请确认 Python 服务已更新并重新启动。", response.status);
    }
    const blob = await response.blob();
    if (!blob.size) throw new ApiError("导出的 Word 文档为空，请重试。", response.status);
    return { blob, filename: safeFilename(response.headers.get("content-disposition")) };
  } catch (error) {
    if (signal?.aborted) throw new DOMException("已取消导出", "AbortError");
    if (error instanceof ApiError) throw error;
    throw new ApiError(controller.signal.aborted
      ? "Word 导出等待超时，当前反馈已保留，可以稍后重试。"
      : "无法连接本地后端，请启动 Python 服务后重试。当前反馈不会改变。", 0);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

export async function downloadFeedbackWord(input: FeedbackWordInput, signal?: AbortSignal): Promise<string> {
  const { blob, filename } = await requestFeedbackWord(input, signal);
  if (signal?.aborted) throw new DOMException("已取消导出", "AbortError");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return filename;
}
