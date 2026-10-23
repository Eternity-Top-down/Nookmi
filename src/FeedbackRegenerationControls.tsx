import { RefreshCw } from "lucide-react";
import { hasPersonalFacts } from "./feedbackModel";
import type { FeedbackEntry, Student } from "./types";
import "./feedbackRegenerationControls.css";

export function regenerationCandidates(
  students: readonly Student[],
  entries: readonly FeedbackEntry[],
): Student[] {
  const entriesById = new Map(entries.map((entry) => [entry.studentId, entry]));
  const seen = new Set<string>();
  return students.filter((student) => {
    const entry = entriesById.get(student.id);
    if (seen.has(student.id) || !entry?.content.trim() || !hasPersonalFacts(entry.observations)) return false;
    seen.add(student.id);
    return true;
  });
}

export function selectedRegenerationTargets(
  students: readonly Student[],
  entries: readonly FeedbackEntry[],
  selectedIds: readonly string[],
): Student[] {
  const selected = new Set(selectedIds);
  return regenerationCandidates(students, entries).filter((student) => selected.has(student.id));
}

export interface FeedbackRegenerationControlsProps {
  students: Student[];
  entries: FeedbackEntry[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onRegenerate: () => void;
  busy: boolean;
  readonly?: boolean;
}

export default function FeedbackRegenerationControls({
  students, entries, selectedIds, onSelectionChange, onRegenerate, busy, readonly,
}: FeedbackRegenerationControlsProps) {
  if (readonly) return null;
  const candidates = regenerationCandidates(students, entries);
  const selected = selectedRegenerationTargets(students, entries, selectedIds);
  const allSelected = candidates.length > 0 && selected.length === candidates.length;
  const partiallySelected = selected.length > 0 && !allSelected;
  const entriesById = new Map(entries.map((entry) => [entry.studentId, entry]));
  const missingFacts = new Set(students.filter((student) => {
    const entry = entriesById.get(student.id);
    return entry?.content.trim() && !hasPersonalFacts(entry.observations);
  }).map((student) => student.id)).size;

  return <div className="fb-regeneration-controls" role="group" aria-label="批量重新生成反馈">
    <div className="fb-regeneration-toolbar">
      <label className="fb-regeneration-select-all">
        <input type="checkbox" checked={allSelected}
          aria-checked={partiallySelected ? "mixed" : allSelected}
          ref={(element) => { if (element) element.indeterminate = partiallySelected; }}
          disabled={busy || candidates.length === 0}
          onChange={(event) => {
            if (!busy) onSelectionChange(event.target.checked ? candidates.map((student) => student.id) : []);
          }} />
        <span>全选可重新生成的反馈</span>
      </label>
      <span className="fb-regeneration-count" aria-live="polite">已选 {selected.length} 人</span>
      <button type="button" className="button button-secondary button-sm"
        disabled={busy || selected.length === 0} onClick={onRegenerate}>
        <RefreshCw size={14} aria-hidden="true" />重新生成已选（{selected.length} 人）
      </button>
    </div>
    <p className="fb-regeneration-hint">新结果成功后替换正文，失败时保留原文；重新生成后需再次核对。</p>
    {missingFacts > 0 && <p className="fb-regeneration-hint">{missingFacts} 人缺少真实记录，补充后可重新生成</p>}
  </div>;
}
