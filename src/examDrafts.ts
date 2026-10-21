import type { Exam, ExamEntry } from './types';

export interface ExamEditorEntry extends Omit<ExamEntry, 'score' | 'maxScore'> {
  score: string;
  maxScore: string;
}
export interface ExamEditor extends Omit<Exam, 'entries' | 'defaultMaxScore'> {
  defaultMaxScore: string;
  entries: ExamEditorEntry[];
}
export interface ExamDraft {
  editor: ExamEditor;
  baseUpdatedAt: string | null;
}
const PREFIX = 'nookmi:exam-draft:v1:';
const scope = (classId: string) => `${PREFIX}${encodeURIComponent(classId)}:`;
const key = (classId: string, examId: string) => `${scope(classId)}${encodeURIComponent(examId)}`;

export function examToEditor(exam: Exam): ExamEditor {
  return { ...exam, defaultMaxScore: String(exam.defaultMaxScore), entries: exam.entries.map(entry => ({ ...entry, maxScore: String(entry.maxScore), score: entry.score === null ? '' : String(entry.score) })) };
}

function isDraft(value: unknown, classId: string): value is ExamDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as ExamDraft;
  const e = draft.editor;
  return !!e && e.classId === classId && typeof e.id === 'string' && e.id.length > 0 &&
    [e.name, e.subject, e.date, e.defaultMaxScore, e.createdAt, e.updatedAt].every(v => typeof v === 'string') &&
    (draft.baseUpdatedAt === null || typeof draft.baseUpdatedAt === 'string') &&
    Array.isArray(e.entries) && e.entries.length <= 50000 && e.entries.every(row => row &&
      [row.studentId, row.school, row.score, row.maxScore].every(v => typeof v === 'string') &&
      ['pending', 'recorded', 'absent'].includes(row.status));
}

export function readExamDrafts(classId: string): { drafts: ExamDraft[]; error: string | null } {
  const drafts: ExamDraft[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (!name?.startsWith(scope(classId))) continue;
      const raw = localStorage.getItem(name);
      const parsed: unknown = JSON.parse(raw ?? 'null');
      if (!isDraft(parsed, classId) || name !== key(classId, parsed.editor.id)) throw new Error();
      drafts.push(parsed);
    }
    return { drafts, error: null };
  } catch {
    return { drafts, error: '本机考试草稿读取失败，请先保存当前成绩，避免直接刷新或离开。' };
  }
}

export function writeExamDraft(draft: ExamDraft): string | null {
  try { localStorage.setItem(key(draft.editor.classId, draft.editor.id), JSON.stringify(draft)); return null; }
  catch { return '本机草稿暂存失败，请保持页面打开并点击保存成绩。'; }
}

export function removeExamDraft(classId: string, examId: string, expected?: ExamDraft): string | null {
  try {
    const draftKey = key(classId, examId);
    const stored = localStorage.getItem(draftKey);
    if (expected && stored !== null && stored !== JSON.stringify(expected)) return '另一个页面更新了本机考试草稿，已保留该副本，请重新打开考试核对。';
    localStorage.removeItem(draftKey); return null;
  }
  catch { return '成绩已保存，但本机旧草稿未能清理，请勿直接覆盖数据库内容。'; }
}

export function clearExamDrafts(classId?: string): string | null {
  try {
    const prefix = classId === undefined ? PREFIX : scope(classId);
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => !!k?.startsWith(prefix));
    keys.forEach(k => localStorage.removeItem(k));
    return null;
  } catch { return '本机考试草稿未能清理，请留意旧草稿提示。'; }
}

export function pruneStudentExamDrafts(classId: string, studentId: string): string | null {
  const result = readExamDrafts(classId);
  if (result.error) return result.error;
  for (const draft of result.drafts) {
    draft.editor.entries = draft.editor.entries.filter(entry => entry.studentId !== studentId);
    const error = writeExamDraft(draft);
    if (error) return error;
  }
  return null;
}

export function editorFingerprint(editor: ExamEditor): string {
  return JSON.stringify({ ...editor, updatedAt: '' });
}

export const examRowErrorKey = (studentId: string) => `student:${studentId}`;

export function validateExamEditor(editor: ExamEditor): { exam: Exam | null; errors: Record<string, string> } {
  const errors: Record<string, string> = Object.create(null);
  const numeric = (text: string) => /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text.trim()) ? Number(text) : NaN;
  const max = numeric(editor.defaultMaxScore);
  if (!editor.name.trim() || editor.name.length > 100) errors.name = '考试名称须为 1–100 个字。';
  if (!editor.subject.trim() || editor.subject.length > 50) errors.subject = '请填写科目（最多 50 个字）。';
  const day = new Date(`${editor.date}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(editor.date) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== editor.date || editor.date < '1900-01-01' || editor.date > '2100-12-31') errors.date = '请选择有效考试日期（1900–2100 年）。';
  if (!Number.isFinite(max) || max <= 0 || max > 1000) errors.defaultMaxScore = '满分须大于 0 且不超过 1000。';
  const entries: ExamEntry[] = editor.entries.map(row => {
    const rowMax = numeric(row.maxScore);
    const score = row.status === 'recorded' ? numeric(row.score) : null;
    if (!Number.isFinite(rowMax) || rowMax <= 0 || rowMax > 1000) errors[examRowErrorKey(row.studentId)] = '满分须大于 0 且不超过 1000。';
    else if (row.status === 'recorded' && (score === null || !Number.isFinite(score) || score < 0 || score > rowMax)) errors[examRowErrorKey(row.studentId)] = `成绩须为 0–${rowMax} 之间的数字；未出分请留空。`;
    else if (row.school.length > 120) errors[examRowErrorKey(row.studentId)] = '学校名称最多 120 个字。';
    return { ...row, school: row.school.trim(), maxScore: rowMax, score };
  });
  return { errors, exam: Object.keys(errors).length ? null : { ...editor, name: editor.name.trim(), subject: editor.subject.trim(), defaultMaxScore: max, entries } };
}
