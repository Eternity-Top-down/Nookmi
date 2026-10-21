import { useEffect, useRef, useState } from 'react';
import type { Exam, Student } from './types';
import { editorFingerprint, examToEditor, readExamDrafts, removeExamDraft, validateExamEditor, writeExamDraft, type ExamDraft, type ExamEditor } from './examDrafts';

export function useExamWorkspace(classId: string, students: Student[], exams: Exam[], onSave: (exam: Exam, automatic?: boolean) => Promise<boolean>, blocked: boolean, onDirtyChange: (dirty: boolean) => void) {
  const [local] = useState(() => readExamDrafts(classId));
  const [drafts, setDrafts] = useState<ExamDraft[]>(local.drafts);
  const [draft, setDraft] = useState<ExamDraft | null>(() => local.drafts.sort((a, b) => b.editor.updatedAt.localeCompare(a.editor.updatedAt))[0] ?? (exams[0] ? { editor: examToEditor(exams[0]), baseUpdatedAt: exams[0].updatedAt } : null));
  const [dirty, setDirty] = useState(!!local.drafts.length);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [localError, setLocalError] = useState(local.error ?? '');
  const [conflict, setConflict] = useState(() => {
    const found = local.drafts[0];
    return !!found && found.baseUpdatedAt !== null && found.baseUpdatedAt !== exams.find(e => e.id === found.editor.id)?.updatedAt;
  });
  const active = useRef(draft);
  active.current = draft;
  const inFlight = useRef(false);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const studentsRef = useRef(students);
  studentsRef.current = students;
  const validation = draft ? validateExamEditor(draft.editor) : { exam: null, errors: {} };

  function cache(next: ExamDraft) {
    const message = writeExamDraft(next);
    setLocalError(message ?? '');
    setDrafts(current => [...current.filter(item => item.editor.id !== next.editor.id), next]);
  }
  function forget(id: string, expected?: ExamDraft) {
    const message = removeExamDraft(classId, id, expected);
    if (message) setLocalError(message);
    else { setLocalError(''); setDrafts(current => current.filter(item => item.editor.id !== id)); }
  }
  function withRoster(editor: ExamEditor): ExamEditor {
    return { ...editor, entries: studentsRef.current.map(student => editor.entries.find(row => row.studentId === student.id) ?? {
      studentId: student.id, school: student.school, status: 'pending', score: '', maxScore: editor.defaultMaxScore,
    }) };
  }
  function change(editor: ExamEditor) {
    const current = active.current;
    if (!current) return;
    const next = { ...current, editor: { ...editor, updatedAt: new Date().toISOString() } };
    active.current = next;
    setDraft(next); setDirty(true); setError(''); cache(next);
  }
  function choose(id: string) {
    if (inFlight.current) return;
    const saved = exams.find(exam => exam.id === id);
    const cached = drafts.find(item => item.editor.id === id);
    const next = cached ?? (saved ? { editor: examToEditor(saved), baseUpdatedAt: saved.updatedAt } : null);
    const adjusted = next ? { ...next, editor: withRoster(next.editor) } : null;
    const changedRoster = next && adjusted && editorFingerprint(next.editor) !== editorFingerprint(adjusted.editor);
    active.current = adjusted; setDraft(adjusted); setDirty(!!cached || !!changedRoster); setError('');
    setConflict(!!cached && cached.baseUpdatedAt !== null && cached.baseUpdatedAt !== saved?.updatedAt);
    if (adjusted && changedRoster) cache(adjusted);
  }
  function create(exam: Exam) {
    const next = { editor: examToEditor(exam), baseUpdatedAt: null };
    active.current = next; setDraft(next); setDirty(true); setConflict(false); setError(''); cache(next);
  }
  async function save() {
    const current = active.current;
    if (!current || inFlight.current || blocked || conflict) return false;
    const checked = validateExamEditor(current.editor);
    if (!checked.exam) return false;
    const exam = { ...checked.exam, updatedAt: new Date().toISOString() };
    const fingerprint = editorFingerprint(current.editor);
    inFlight.current = true; setSaving(true); setError('');
    let ok = false;
    try { ok = await saveRef.current(exam, true); }
    catch { ok = false; }
    if (ok) {
      const latest = active.current;
      if (latest?.editor.id === exam.id) {
        const unchanged = editorFingerprint(latest.editor) === fingerprint;
        const next = { ...latest, baseUpdatedAt: exam.updatedAt, editor: { ...latest.editor, updatedAt: exam.updatedAt } };
        active.current = next; setDraft(next); setDirty(!unchanged);
        if (unchanged) forget(exam.id, latest); else cache(next);
      }
    } else setError('保存未完成，输入仍保留在本机草稿中。请检查数据库连接后重试。');
    inFlight.current = false; setSaving(false);
    return ok;
  }
  function useDatabase() {
    const id = active.current?.editor.id;
    if (!id) return;
    const saved = exams.find(e => e.id === id);
    forget(id, active.current ?? undefined);
    const next = saved ? { editor: withRoster(examToEditor(saved)), baseUpdatedAt: saved.updatedAt } : null;
    active.current = next; setDraft(next); setDirty(false); setConflict(false); setError('');
  }
  function recoverAsNew() {
    const current = active.current;
    if (!current) return;
    const now = new Date().toISOString();
    const next = { editor: { ...withRoster(current.editor), id: crypto.randomUUID(), name: `${current.editor.name.slice(0, 94)}（恢复）`, createdAt: now, updatedAt: now }, baseUpdatedAt: null };
    const message = writeExamDraft(next);
    if (message) { setLocalError(message); return; }
    forget(current.editor.id, current);
    active.current = next; setDraft(next); setDirty(true); setConflict(false); setError(''); cache(next);
  }
  function afterDelete(id: string) {
    forget(id, active.current ?? undefined);
    const other = exams.find(exam => exam.id !== id);
    const cached = drafts.find(item => item.editor.id !== id);
    const next = cached ? { ...cached, editor: withRoster(cached.editor) } : other ? { editor: withRoster(examToEditor(other)), baseUpdatedAt: other.updatedAt } : null;
    active.current = next; setDraft(next); setDirty(!!cached); setError('');
    setConflict(!!cached && cached.baseUpdatedAt !== null && cached.baseUpdatedAt !== exams.find(e => e.id === cached.editor.id)?.updatedAt);
  }

  useEffect(() => {
    const current = active.current;
    if (!current) return;
    const updated = withRoster(current.editor);
    if (editorFingerprint(updated) !== editorFingerprint(current.editor)) change(updated);
    // Only roster membership changes add or remove entries; saved school names are snapshots.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students.map(student => student.id).join('|')]);
  useEffect(() => {
    onDirtyChange(!!localError || !!error || conflict || (blocked && dirty));
    return () => onDirtyChange(false);
  }, [localError, error, conflict, blocked, dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty || saving || error || blocked || conflict || !validation.exam) return;
    const timer = setTimeout(() => void save(), 900);
    return () => clearTimeout(timer);
    // save reads the latest draft from active.current, not a stale timeout snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, dirty, saving, error, blocked, conflict]);
  return { draft, drafts, dirty, saving, error, localError, conflict, validation, change, choose, create, save, useDatabase, recoverAsNew, afterDelete };
}
