import { useEffect, useRef, useState } from "react";
import { Download, LoaderCircle } from "lucide-react";
import { Modal } from "./components";
import { downloadFeedbackWord, feedbackWordSnapshot } from "./feedbackWordExportApi";
import type { FeedbackSession, Student } from "./types";

export interface FeedbackWordExportProps {
  session: FeedbackSession;
  students: Student[];
  className?: string;
  buttonClassName?: string;
}

export default function FeedbackWordExport({ session, students, className, buttonClassName = "button button-secondary button-sm" }: FeedbackWordExportProps) {
  const [snapshot, setSnapshot] = useState<ReturnType<typeof feedbackWordSnapshot> | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  if (session.module === "one-to-one") return null;
  const available = feedbackWordSnapshot(session, students);

  function close() {
    pending.current?.abort();
    pending.current = null;
    setBusy(false);
    setSnapshot(null);
  }

  async function download() {
    if (!snapshot || busy) return;
    if (!title.trim()) { setError("请填写文档标题。"); return; }
    if (title.trim().length > 200) { setError("文档标题不能超过 200 字。"); return; }
    setBusy(true);
    setError("");
    const controller = new AbortController();
    pending.current = controller;
    try {
      await downloadFeedbackWord({ title: title.trim(), entries: snapshot.entries }, controller.signal);
      if (!controller.signal.aborted) {
        setSnapshot(null);
        setNotice("已开始下载 Word 文档。");
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Word 导出失败，请重试。");
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  return <>
    <button type="button" className={buttonClassName} disabled={!available.entries.length}
      title={!available.entries.length ? "先完成至少一位学生的反馈正文" : "按当前正文导出 Word"}
      onClick={() => { setSnapshot(available); setTitle(""); setError(""); setNotice(""); }}><Download size={15} />导出 Word</button>
    {notice && <span className="field-hint" role="status">{notice}</span>}
    {snapshot && <Modal title="导出反馈 Word" onClose={close}>
      <form onSubmit={(event) => { event.preventDefault(); void download(); }}>
        <label className="field">文档标题<input value={title} maxLength={200} disabled={busy}
          placeholder={`${className?.trim() || "班级名称"}${session.module === "evening" ? "本周晚辅反馈" : "本月班课反馈"}`}
          onChange={(event) => { setTitle(event.target.value); setError(""); }} /></label>
        <p className="field-hint">将导出 {snapshot.entries.length} 位学生的当前反馈正文{snapshot.skipped ? `，跳过 ${snapshot.skipped} 位尚无正文的学生` : ""}。</p>
        {snapshot.unreviewed > 0 && <p className="field-hint">其中 {snapshot.unreviewed} 位的正文尚未核对，仍会一并导出，请检查后再发送。</p>}
        <p className="field-hint">全文为宋体小四，学生姓名加粗，按学生顺序排列。</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="button button-secondary" onClick={close}>取消</button>
          <button type="submit" className="button button-primary" disabled={busy || !title.trim()}>
            {busy ? <LoaderCircle size={16} className="fb-spin" /> : <Download size={16} />}{busy ? "正在导出…" : "下载 Word"}</button>
        </div>
      </form>
    </Modal>}
  </>;
}
