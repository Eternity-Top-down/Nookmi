import { useMemo, useRef, useState } from 'react';
import { BarChart3, Download, Plus, Save, Settings2, Trash2, ClipboardPaste, TrendingUp } from 'lucide-react';
import { Modal } from './components';
import type { ClassGroup, Exam, Student } from './types';
import { examRowErrorKey, validateExamEditor, type ExamEditor } from './examDrafts';
import { entryRate, exportExamCsv, parseExamPaste, previousExam, sortExams, summarizeExam } from './examModel';
import { useExamWorkspace } from './useExamWorkspace';
import './exam.css';

interface Props {
  group: ClassGroup;
  students: Student[];
  exams: Exam[];
  onSave: (exam: Exam, automatic?: boolean) => Promise<boolean>;
  onDelete: (exam: Exam) => Promise<boolean>;
  autoSaveBlocked: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const number = (value: number | null, suffix = '') => value === null ? '—' : `${Number(value.toFixed(1))}${suffix}`;
function downloadCsv(exam: Exam, students: Student[]) {
  const url = URL.createObjectURL(new Blob([exportExamCsv(exam, students)], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${exam.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}-成绩.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Trend({ exams, students, selected }: { exams: Exam[]; students: Student[]; selected: Exam }) {
  const [studentId, setStudentId] = useState('all');
  const history = sortExams(exams.filter(exam => exam.subject.trim() === selected.subject.trim() && exam.classId === selected.classId)).slice(0, 8).reverse();
  const points = history.map(exam => ({ exam, rate: studentId === 'all' ? summarizeExam(exam).meanRate : entryRate(exam.entries.find(entry => entry.studentId === studentId) ?? { studentId, score: null, maxScore: 100, school: '', status: 'pending' }) }));
  const groups: string[][] = [[]];
  points.forEach((point, index) => {
    if (point.rate === null) { if (groups[groups.length - 1].length) groups.push([]); return; }
    groups[groups.length - 1].push(`${45 + index * 530 / Math.max(1, points.length - 1)},${145 - point.rate * 1.2}`);
  });
  return <section className="exam-panel exam-trend">
    <div className="exam-panel-heading"><div><h3><TrendingUp size={17} /> 得分率变化</h3><p>最近 8 次同科考试 · 各次试卷难度、参考人数可能不同</p></div>
      <label className="field"><span className="sr-only">查看谁的成绩趋势</span><select aria-label="查看谁的成绩趋势" value={studentId} onChange={event => setStudentId(event.target.value)}><option value="all">全班平均得分率</option>{students.map(student => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label></div>
    {history.length < 2 ? <p className="exam-empty-note">再录入一次{selected.subject}考试，就能看到连续变化。缺考、未录入不会画成 0 分。</p> : <>
      <svg className="exam-trend-chart" viewBox="0 0 620 185" role="img" aria-label={`${studentId === 'all' ? '全班平均' : students.find(s => s.id === studentId)?.name ?? '学生'}得分率变化，具体数值见下方列表`}>
        {[0, 50, 100].map(value => <g key={value}><line x1="40" y1={145 - value * 1.2} x2="590" y2={145 - value * 1.2} stroke="#e3e9e3" /><text x="31" y={149 - value * 1.2} textAnchor="end">{value}%</text></g>)}
        {groups.filter(group => group.length > 1).map((group, i) => <polyline key={i} points={group.join(' ')} fill="none" stroke="#547b61" strokeWidth="2.5" />)}
        {points.map((point, i) => <g key={point.exam.id}>{point.rate !== null && <circle cx={45 + i * 530 / Math.max(1, points.length - 1)} cy={145 - point.rate * 1.2} r="4" fill="#547b61"><title>{point.exam.name}：{number(point.rate, '%')}</title></circle>}<text x={45 + i * 530 / Math.max(1, points.length - 1)} y="173" textAnchor="middle">{point.exam.date.slice(5)}</text></g>)}
      </svg>
      <div className="exam-trend-values">{points.map(point => <div key={point.exam.id}><span>{point.exam.name}</span><strong>{number(point.rate, '%')}</strong><small>{point.exam.date}{studentId === 'all' ? ` · ${summarizeExam(point.exam).count} 人` : ''}</small></div>)}</div>
    </>}
  </section>;
}

export default function ExamWorkspace({ group, students, exams: allExams, onSave, onDelete, autoSaveBlocked, onDirtyChange }: Props) {
  const exams = useMemo(() => sortExams(allExams), [allExams]);
  const state = useExamWorkspace(group.id, students, exams, onSave, autoSaveBlocked, onDirtyChange);
  const editor = state.draft?.editor;
  const [settings, setSettings] = useState<{ mode: 'new' | 'edit'; name: string; subject: string; date: string; max: string } | null>(null);
  const [settingsError, setSettingsError] = useState('');
  const [paste, setPaste] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const scoreInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const errors = state.validation.errors;
  // Invalid rows stay visible for correction and never enter averages as zero.
  const preview: Exam | null = editor ? { ...editor, defaultMaxScore: Number(editor.defaultMaxScore), entries: editor.entries.filter(row => !errors[examRowErrorKey(row.studentId)]).map(row => ({ ...row, maxScore: Number(row.maxScore), score: row.status === 'recorded' ? Number(row.score) : null })) } : null;
  const summary = preview ? summarizeExam(preview) : null;
  const previous = preview ? previousExam(exams, preview) : undefined;
  const options = [...new Map([...exams.map(exam => [exam.id, { id: exam.id, name: exam.name, date: exam.date, subject: exam.subject }] as const), ...state.drafts.map(draft => [draft.editor.id, draft.editor] as const)]).values()].sort((a, b) => b.date.localeCompare(a.date));
  const pasteContext: Exam | null = editor ? { ...editor, defaultMaxScore: Number(editor.defaultMaxScore), entries: editor.entries.map(row => ({ ...row, maxScore: Number(row.maxScore), score: row.status === 'recorded' ? Number(row.score) : null })) } : null;
  const rows = paste !== null && pasteContext ? parseExamPaste(paste, students, pasteContext) : [];
  const invalidCount = Object.keys(errors).length;
  function openNew() { setSettingsError(''); setSettings({ mode: 'new', name: '', subject: editor?.subject ?? '数学', date: today(), max: editor?.defaultMaxScore ?? (group.grade.includes('高') ? '150' : '100') }); }
  function setEntry(studentId: string, fields: Partial<ExamEditor['entries'][number]>) {
    if (!editor) return;
    state.change({ ...editor, entries: editor.entries.map(entry => entry.studentId === studentId ? { ...entry, ...fields } : entry) });
  }
  function submitSettings() {
    if (!settings) return;
    const now = new Date().toISOString();
    const next: ExamEditor = {
      id: settings.mode === 'edit' && editor ? editor.id : crypto.randomUUID(), classId: group.id, name: settings.name.trim(), subject: settings.subject.trim(), date: settings.date, defaultMaxScore: settings.max,
      entries: settings.mode === 'edit' && editor ? editor.entries.map(entry => entry.status === 'pending' ? { ...entry, maxScore: settings.max } : entry) : students.map(student => ({ studentId: student.id, school: student.school, score: '', maxScore: settings.max, status: 'pending' })),
      createdAt: settings.mode === 'edit' && editor ? editor.createdAt : now, updatedAt: now,
    };
    const validation = validateExamEditor({ ...next, entries: [] });
    if (!validation.exam) { setSettingsError(Object.values(validation.errors).join(' ')); return; }
    if (settings.mode === 'edit') state.change(next);
    else state.create({ ...validation.exam, entries: next.entries.map(entry => ({ ...entry, score: null, maxScore: Number(entry.maxScore) })) });
    setSettings(null);
  }
  async function remove() {
    if (!editor || deleting) return;
    setDeleting(true);
    const saved = exams.find(exam => exam.id === editor.id);
    try {
      if (!saved || await onDelete(saved)) { state.afterDelete(editor.id); setConfirmDelete(false); }
    } finally { setDeleting(false); }
  }
  const historyWithCurrent = preview ? [...exams.filter(exam => exam.id !== preview.id), preview] : exams;

  return <section className="exam-workspace" aria-label="班课考试成绩">
    <div className="exam-heading"><div><span className="exam-eyebrow">看见变化 · 找到重点</span><h2>考试成绩</h2><p>记下真实成绩，结合学校与试卷背景观察每位学生。</p></div><button className="button button-primary" onClick={openNew} disabled={state.saving || deleting}><Plus size={17} />新建考试</button></div>
    {!editor ? <div className="exam-empty"><BarChart3 size={38} /><h3>从第一次月考开始</h3><p>创建考试后，全班名单会自动带入。填成绩即可看到统计。</p><button className="button button-primary" onClick={openNew}>新建第一次考试</button></div> : <>
      <div className="exam-toolbar">
        <label className="field exam-picker"><span>选择考试</span><select value={editor.id} disabled={state.saving || deleting} onChange={event => state.choose(event.target.value)}>{options.map(exam => <option key={exam.id} value={exam.id}>{exam.date} · {exam.name} · {exam.subject}</option>)}</select></label>
        <div className="exam-actions"><button className="button button-secondary button-sm" disabled={deleting} onClick={() => { setSettingsError(''); setSettings({ mode: 'edit', name: editor.name, subject: editor.subject, date: editor.date, max: editor.defaultMaxScore }); }}><Settings2 size={15} />考试设置</button><button className="button button-secondary button-sm" disabled={!state.validation.exam || !summary?.count} onClick={() => state.validation.exam && downloadCsv(state.validation.exam, students)}><Download size={15} />导出成绩</button><button className="icon-button" aria-label="删除这次考试" disabled={state.saving || deleting} onClick={() => setConfirmDelete(true)}><Trash2 size={16} /></button></div>
      </div>
      <div className="exam-context"><span>{editor.subject} · {editor.date}</span><span>各校可能不同卷；得分率用于记录观察，不混排班级名次。</span></div>
      {state.conflict && <div className="exam-alert" role="alert"><p>数据库中的这次考试已改变或删除。本机另有未同步内容，请先选择处理方式。</p><div className="button-row"><button className="button button-secondary button-sm" onClick={state.useDatabase}>使用数据库版本</button><button className="button button-secondary button-sm" onClick={state.recoverAsNew}>本机内容另存为新考试</button></div></div>}
      {autoSaveBlocked && <p className="exam-alert" role="alert">数据库存在版本冲突，自动保存已暂停。请先使用页面上方的重新载入功能；本机草稿会保留。</p>}
      {(state.error || state.localError) && <p className="exam-alert" role="alert">{state.error || state.localError}</p>}
      {summary && <>
        <div className="exam-stat-grid">
          <div><span>已录成绩</span><strong>{summary.count}<small> / {students.length} 人</small></strong><p>未录 {summary.pending} · 缺考 {summary.absent}{invalidCount ? ` · ${invalidCount} 处待修正` : ''}</p></div>
          <div><span>平均得分率</span><strong>{number(summary.meanRate)}<small>{summary.meanRate === null ? '' : '%'}</small></strong><p>先算每人的得分率，再取平均</p></div>
          <div><span>平均分</span><strong>{number(summary.meanScore)}<small>{summary.commonMaxScore === null ? '' : ` / ${summary.commonMaxScore}`}</small></strong><p>{summary.count && summary.commonMaxScore === null ? '满分不同，请参考得分率' : '同满分成绩汇总，试卷可能不同'}</p></div>
          <div><span>得分率中位数</span><strong>{number(summary.medianRate)}<small>{summary.medianRate === null ? '' : '%'}</small></strong><p>一半已录成绩在此值两侧</p></div>
        </div>
        <section className="exam-panel">
          <div className="exam-panel-heading"><div><h3>全班录入</h3><p>满分已带入，可按学生修改。录完成绩按 Enter 到下一位。</p></div><button className="button button-secondary button-sm" disabled={deleting} onClick={() => setPaste('')}><ClipboardPaste size={15} />粘贴成绩</button></div>
          {previous && <p className="exam-comparison-note">对照上次：{previous.name}（{previous.date}）。变化以百分点表示；不同试卷的变化不直接代表能力提升或下降。</p>}
          {!students.length ? <p className="exam-empty-note">当前班级还没有学生，请先在“学生管理”中添加名单。</p> : <div className="exam-table-wrap"><table className="exam-entry-table"><thead><tr><th scope="col">学生</th><th scope="col">学校</th><th scope="col">成绩</th><th scope="col">满分</th><th scope="col">状态</th><th scope="col">较上次</th></tr></thead><tbody>{students.map((student, index) => {
            const row = editor.entries.find(entry => entry.studentId === student.id);
            if (!row) return null;
            const rate = preview ? entryRate(preview.entries.find(entry => entry.studentId === student.id) ?? { studentId: student.id, school: '', maxScore: 100, score: null, status: 'pending' }) : null;
            const prior = previous?.entries.find(entry => entry.studentId === student.id);
            const priorRate = prior ? entryRate(prior) : null;
            const delta = rate !== null && priorRate !== null ? rate - priorRate : null;
            return <tr key={student.id}><th scope="row"><strong>{student.name}</strong>{errors[examRowErrorKey(student.id)] && <span className="exam-row-error" id={`exam-error-${student.id}`}>{errors[examRowErrorKey(student.id)]}</span>}</th><td><input aria-label={`${student.name}的考试学校`} placeholder="未填学校" maxLength={120} value={row.school} onChange={event => setEntry(student.id, { school: event.target.value })} /></td><td><input ref={element => { scoreInputs.current[student.id] = element; }} aria-label={`${student.name}的成绩`} aria-invalid={!!errors[examRowErrorKey(student.id)]} aria-describedby={errors[examRowErrorKey(student.id)] ? `exam-error-${student.id}` : undefined} inputMode="decimal" maxLength={12} placeholder={row.status === 'absent' ? '缺考' : '未出分'} disabled={row.status === 'absent' || deleting} value={row.score} onChange={event => setEntry(student.id, { score: event.target.value, status: event.target.value.trim() ? 'recorded' : 'pending' })} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); const next = students.slice(index + 1).find(s => editor.entries.find(e => e.studentId === s.id)?.status !== 'absent'); if (next) scoreInputs.current[next.id]?.focus(); } }} /></td><td><input aria-label={`${student.name}的满分`} inputMode="decimal" maxLength={12} value={row.maxScore} onChange={event => setEntry(student.id, { maxScore: event.target.value })} /></td><td><select aria-label={`${student.name}的成绩状态`} value={row.status} onChange={event => { const status = event.target.value as 'pending' | 'recorded' | 'absent'; setEntry(student.id, { status, score: status === 'recorded' ? row.score : '' }); }}><option value="pending">未录入</option><option value="recorded">已录入</option><option value="absent">缺考</option></select></td><td className="exam-delta"><strong className={delta !== null && delta > 0 ? 'exam-rise' : ''}>{delta === null ? '—' : `${delta > 0 ? '+' : ''}${number(delta)} 个百分点`}</strong><small>{priorRate === null ? '无有效对照' : `上次 ${prior?.score}/${prior?.maxScore}`}</small></td></tr>;
          })}</tbody></table></div>}
          <div className="exam-save-row"><span role="status">{state.saving ? '正在后台保存…' : state.dirty ? invalidCount ? '草稿已暂存；修正提示中的内容后将自动保存。' : '本机草稿已暂存' : '已保存到本机数据库'}</span><button className="button button-primary button-sm" disabled={!state.dirty || state.saving || !state.validation.exam || state.conflict || autoSaveBlocked || deleting} onClick={() => void state.save()}><Save size={15} />{state.saving ? '保存中…' : '保存成绩'}</button></div>
        </section>
        <div className="exam-charts-grid">
          <section className="exam-panel"><div className="exam-panel-heading"><div><h3>得分率分布</h3><p>仅统计已录成绩，缺考与未录入不计入分母</p></div></div>{summary.count ? <><div className="exam-distribution">{summary.bands.map(band => <div key={band.label}><span>{band.label}</span><div className="exam-bar-track"><i style={{ width: `${band.count / summary.count * 100}%` }} /></div><strong>{band.count} 人</strong></div>)}</div><p className="exam-distribution-note">达 60%：{summary.atLeast60} 人（{number(summary.atLeast60 / summary.count * 100, '%')}） · 达 85%：{summary.atLeast85} 人（{number(summary.atLeast85 / summary.count * 100, '%')}）</p></> : <p className="exam-empty-note">录入第一位学生的成绩后显示分布。</p>}</section>
          <section className="exam-panel"><div className="exam-panel-heading"><div><h3>按学校汇总</h3><p>同校、同满分分组；未填学校的记录单独展示</p></div></div>{summary.schoolGroups.length ? <div className="exam-table-wrap"><table className="exam-school-table"><thead><tr><th>学校 / 满分</th><th>人数</th><th>平均分</th><th>得分率</th></tr></thead><tbody>{summary.schoolGroups.map(school => <tr key={`${school.school}:${school.maxScore}`}><th>{school.school || '未填学校'}<small>满分 {school.maxScore}</small></th><td>{school.count}</td><td>{number(school.meanScore)}</td><td>{number(school.meanRate, '%')}</td></tr>)}</tbody></table></div> : <p className="exam-empty-note">学校可沿用学生档案，也可直接在本次录分表中调整。</p>}</section>
        </div>
        <Trend key={group.id} exams={historyWithCurrent} selected={preview!} students={students} />
      </>}
    </>}
    {settings && <Modal title={settings.mode === 'new' ? '新建考试' : '考试设置'} onClose={() => setSettings(null)}><form onSubmit={event => { event.preventDefault(); submitSettings(); }}><label className="field">考试名称<input autoFocus maxLength={100} value={settings.name} placeholder="例如：第一次月考" onChange={event => setSettings({ ...settings, name: event.target.value })} /></label><div className="exam-settings-grid"><label className="field">考试日期<input type="date" min="1900-01-01" max="2100-12-31" value={settings.date} onChange={event => setSettings({ ...settings, date: event.target.value })} /></label><label className="field">科目<input maxLength={50} value={settings.subject} onChange={event => setSettings({ ...settings, subject: event.target.value })} /></label><label className="field">默认满分<input inputMode="decimal" maxLength={12} value={settings.max} onChange={event => setSettings({ ...settings, max: event.target.value })} /></label></div><p className="field-hint">默认满分先带入全班，个别学生可以修改。{settings.mode === 'edit' ? '修改默认满分只影响未录入学生，已有成绩和缺考记录保留。' : '学校自动沿用学生档案，不需要重复填写。'}</p>{settingsError && <p className="exam-alert" role="alert">{settingsError}</p>}<div className="form-actions"><button type="button" className="button button-secondary" onClick={() => setSettings(null)}>取消</button><button type="submit" className="button button-primary">{settings.mode === 'new' ? '创建并录入成绩' : '应用设置'}</button></div></form></Modal>}
    {paste !== null && editor && <Modal title="批量粘贴成绩" wide onClose={() => setPaste(null)}><p className="exam-modal-help">从 Excel 复制“姓名、成绩、满分”三列，也可只粘贴前两列。缺考写“缺考”，未出分写“未录”。先预览，再应用；未列出的学生保持原样。</p><label className="field">成绩文本<textarea rows={5} value={paste} maxLength={100000} placeholder={'姓名\t成绩\t满分\n张同学\t108\t150\n李同学\t缺考\t100'} onChange={event => setPaste(event.target.value)} /></label>{rows.length > 0 && <div className="exam-paste-preview">{rows.map(row => <div key={row.line}><strong>第 {row.line} 行 · {row.name || '待识别'}</strong><span className={row.errors.length ? 'exam-row-error' : ''}>{row.errors.length ? row.errors.join('；') : row.entry?.status === 'recorded' ? `${row.entry.score} / ${row.entry.maxScore}` : row.entry?.status === 'absent' ? '缺考' : '未录入'}</span></div>)}</div>}<div className="form-actions"><button className="button button-secondary" onClick={() => setPaste(null)}>取消</button><button className="button button-primary" disabled={!rows.length || rows.some(row => row.errors.length)} onClick={() => { const updates = new Map(rows.flatMap(row => row.entry ? [[row.entry.studentId, row.entry] as const] : [])); state.change({ ...editor, entries: editor.entries.map(entry => { const update = updates.get(entry.studentId); return update ? { ...update, score: update.score === null ? '' : String(update.score), maxScore: String(update.maxScore) } : entry; }) }); setPaste(null); }}>应用 {rows.filter(row => !row.errors.length).length} 位学生的成绩</button></div></Modal>}
    {confirmDelete && editor && <Modal title="删除这次考试？" onClose={() => { if (!deleting) setConfirmDelete(false); }}><p>将删除「{editor.name}」的考试设置、全班成绩和本机草稿。其他考试不受影响，此操作无法撤销。</p><div className="form-actions"><button className="button button-secondary" disabled={deleting} onClick={() => setConfirmDelete(false)}>取消</button><button className="button button-danger" disabled={deleting} onClick={() => void remove()}>{deleting ? '正在删除…' : '确认删除考试'}</button></div></Modal>}
  </section>;
}
