import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Check,
  Download,
  FileSpreadsheet,
  Upload,
  X,
} from "lucide-react";
import { parseStudentImport, validateStudent } from "./data";
import {
  EMPTY_STUDENT,
  type ClassGroup,
  type ImportRow,
  type Student,
  type StudentFields,
} from "./types";

const GRADES = [
  "一年级",
  "二年级",
  "三年级",
  "四年级",
  "五年级",
  "六年级",
  "初一",
  "初二",
  "初三",
  "高一",
  "高二",
  "高三",
];
const IMPORT_SAMPLE =
  "姓名\t年级\t学校\t家长\t联系电话\t备注\n示例学生甲\t初一\t示例中学\t\t\t关注计算习惯\n示例学生乙\t初一\t示例中学\t\t\t";

export function Modal({
  title,
  subtitle,
  wide = false,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      const initial = dialogRef.current?.querySelector<HTMLElement>(
        'input:not([type="file"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [data-autofocus]',
      );
      (initial ?? dialogRef.current)?.focus();
    });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialogRef.current)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialogRef.current.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal${wide ? " modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p id={descriptionId}>{subtitle}</p>}
          </div>
          <button
            type="button"
            className="modal-close button button-ghost"
            onClick={onClose}
            aria-label="关闭弹窗"
          >
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function ErrorMessages({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return (
    <div className="form-error" role="alert">
      {errors.map((error, index) => (
        <p key={`${index}-${error}`}>{error}</p>
      ))}
    </div>
  );
}

export function StudentForm({
  initial,
  defaultGrade = "",
  onSubmit,
  onCancel,
}: {
  initial?: StudentFields;
  defaultGrade?: string;
  onSubmit: (fields: StudentFields) => void;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState<StudentFields>(() => ({
    name: initial?.name ?? EMPTY_STUDENT.name,
    grade: initial?.grade ?? defaultGrade,
    school: initial?.school ?? EMPTY_STUDENT.school,
    guardian: initial?.guardian ?? EMPTY_STUDENT.guardian,
    phone: initial?.phone ?? EMPTY_STUDENT.phone,
    notes: initial?.notes ?? EMPTY_STUDENT.notes,
  }));
  const [errors, setErrors] = useState<string[]>([]);
  const gradeListId = useId();
  const update = (key: keyof StudentFields, value: string) =>
    setFields((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean: StudentFields = {
      name: fields.name.trim(),
      grade: fields.grade.trim() || defaultGrade.trim(),
      school: fields.school.trim(),
      guardian: fields.guardian.trim(),
      phone: fields.phone.trim(),
      notes: fields.notes.trim(),
    };
    const issues = validateStudent(clean);
    setErrors(issues);
    if (!issues.length) onSubmit(clean);
  };
  return (
    <form onSubmit={submit}>
      <div className="field-grid">
        <label className="field">
          学生姓名 <span aria-hidden="true">*</span>
          <input
            value={fields.name}
            onChange={(event) => update("name", event.target.value)}
            required
            maxLength={80}
            autoComplete="off"
            placeholder="请输入学生姓名"
          />
        </label>
        <label className="field">
          年级
          <input
            value={fields.grade}
            onChange={(event) => update("grade", event.target.value)}
            list={gradeListId}
            maxLength={50}
            placeholder="选择或输入年级"
          />
        </label>
        <datalist id={gradeListId}>
          {GRADES.map((grade) => (
            <option key={grade} value={grade} />
          ))}
        </datalist>
        <label className="field field-wide">
          就读学校
          <input
            value={fields.school}
            onChange={(event) => update("school", event.target.value)}
            maxLength={120}
            placeholder="例如：实验中学"
          />
        </label>
        <label className="field">
          家长称呼
          <input
            value={fields.guardian}
            onChange={(event) => update("guardian", event.target.value)}
            maxLength={80}
            placeholder="例如：王妈妈"
          />
        </label>
        <label className="field">
          联系电话
          <input
            type="tel"
            value={fields.phone}
            onChange={(event) => update("phone", event.target.value)}
            maxLength={80}
            placeholder="手机号或固定电话（选填）"
          />
        </label>
        <label className="field field-wide">
          学情备注
          <textarea
            value={fields.notes}
            onChange={(event) => update("notes", event.target.value)}
            maxLength={5000}
            rows={3}
            placeholder="记录学习情况、关注点或沟通偏好…"
          />
        </label>
      </div>
      <p className="field-hint">
        只需填写姓名即可建立档案，其他信息可以稍后补充。
      </p>
      <ErrorMessages errors={errors} />
      <div className="form-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={onCancel}
        >
          取消
        </button>
        <button type="submit" className="button button-primary">
          <Check size={16} />
          保存学生
        </button>
      </div>
    </form>
  );
}

export function ClassForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: ClassGroup;
  onSubmit: (
    fields: Pick<ClassGroup, "name" | "grade" | "schedule" | "notes">,
  ) => void;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState({
    name: initial?.name ?? "",
    grade: initial?.grade ?? "",
    schedule: initial?.schedule ?? "",
    notes: initial?.notes ?? "",
  });
  const [errors, setErrors] = useState<string[]>([]);
  const gradeListId = useId();
  const update = (key: keyof typeof fields, value: string) =>
    setFields((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const clean = {
      name: fields.name.trim(),
      grade: fields.grade.trim(),
      schedule: fields.schedule.trim(),
      notes: fields.notes.trim(),
    };
    const issues: string[] = [];
    if (!clean.name) issues.push("请填写班级名称。");
    if (clean.name.length > 100) issues.push("班级名称不能超过 100 字。");
    if (clean.grade.length > 50) issues.push("年级不能超过 50 字。");
    if (clean.schedule.length > 200) issues.push("上课时间不能超过 200 字。");
    if (clean.notes.length > 5000) issues.push("班级备注不能超过 5000 字。");
    setErrors(issues);
    if (!issues.length) onSubmit(clean);
  };
  return (
    <form onSubmit={submit}>
      <div className="field-grid">
        <label className="field">
          班级名称 <span aria-hidden="true">*</span>
          <input
            value={fields.name}
            onChange={(event) => update("name", event.target.value)}
            required
            maxLength={100}
            placeholder="例如：初一晚辅 A 班"
          />
        </label>
        <label className="field">
          默认年级
          <input
            value={fields.grade}
            onChange={(event) => update("grade", event.target.value)}
            list={gradeListId}
            maxLength={50}
            placeholder="选择或输入年级"
          />
        </label>
        <datalist id={gradeListId}>
          {GRADES.map((grade) => (
            <option key={grade} value={grade} />
          ))}
        </datalist>
        <label className="field field-wide">
          上课时间
          <input
            value={fields.schedule}
            onChange={(event) => update("schedule", event.target.value)}
            maxLength={200}
            placeholder="例如：周一至周五 18:30–20:30"
          />
        </label>
        <label className="field field-wide">
          班级备注
          <textarea
            value={fields.notes}
            onChange={(event) => update("notes", event.target.value)}
            maxLength={5000}
            rows={3}
            placeholder="记录班级安排和教学方向…"
          />
        </label>
      </div>
      <p className="field-hint">
        录入学生时，空白年级会自动采用班级的默认年级。
      </p>
      <ErrorMessages errors={errors} />
      <div className="form-actions">
        <button
          type="button"
          className="button button-secondary"
          onClick={onCancel}
        >
          取消
        </button>
        <button type="submit" className="button button-primary">
          <Check size={16} />
          保存班级
        </button>
      </div>
    </form>
  );
}

export function ImportStudents({
  existing,
  defaultGrade = "",
  onSubmit,
  onCancel,
}: {
  existing: Student[];
  defaultGrade?: string;
  onSubmit: (fields: StudentFields[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(0);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileReadId = useRef(0);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (rows) previewRef.current?.focus();
  }, [rows]);
  useEffect(
    () => () => {
      fileReadId.current++;
    },
    [],
  );

  const updateText = (content: string) => {
    fileReadId.current++;
    setReading(false);
    setText(content);
    setFileName("");
    setError("");
  };

  const preview = () => {
    setError("");
    if (!text.trim()) {
      setError("请先粘贴学生名单或选择 CSV / TSV 文件。");
      return;
    }
    const parsed = parseStudentImport(text, existing, defaultGrade);
    if (!parsed.length) {
      setError("没有找到学生信息。请在表头下方填写学生姓名。");
      return;
    }
    setRows(parsed);
    setPage(0);
    setSelected(
      new Set(
        parsed.flatMap((row, index) =>
          !row.errors.length && !row.duplicate ? [index] : [],
        ),
      ),
    );
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    const readId = ++fileReadId.current;
    setError("");
    setReading(false);
    if (file.size > 2 * 1024 * 1024) {
      setError("文件不能超过 2 MB，请将名单分批导入。");
      return;
    }
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      setError(
        "请选择 CSV、TSV 或 TXT 文件；Excel 文件请先复制单元格，或另存为 CSV UTF-8。",
      );
      return;
    }
    setReading(true);
    try {
      const content = await file.text();
      if (readId !== fileReadId.current) return;
      if (content.includes("\uFFFD")) {
        setError(
          "文件编码无法识别。请在 Excel 中另存为「CSV UTF-8」，或直接复制单元格粘贴。",
        );
        return;
      }
      setText(content);
      setFileName(file.name);
      setRows(null);
    } catch {
      if (readId === fileReadId.current)
        setError("文件读取失败，请重新选择文件或直接粘贴名单。");
    } finally {
      if (readId === fileReadId.current) setReading(false);
    }
  };
  const downloadTemplate = () => {
    const content =
      "\uFEFF姓名,年级,学校,家长,联系电话,备注\r\n示例学生甲,初一,示例中学,,,请将示例行替换为实际学生信息\r\n";
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/csv;charset=utf-8;" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "Nookmi-学生导入模板.csv";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const toggle = (index: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  const validIndexes =
    rows?.flatMap((row, index) => (!row.errors.length ? [index] : [])) ?? [];
  const allSelected =
    validIndexes.length > 0 &&
    validIndexes.every((index) => selected.has(index));
  const invalidCount = rows?.filter((row) => row.errors.length).length ?? 0;
  const duplicateCount =
    rows?.filter((row) => row.duplicate && !row.errors.length).length ?? 0;
  const selectedDuplicates =
    rows?.filter((row, index) => selected.has(index) && row.duplicate).length ??
    0;
  const pageSize = 100;
  const pageCount = Math.ceil((rows?.length ?? 0) / pageSize);
  const visibleRows = rows?.slice(page * pageSize, (page + 1) * pageSize) ?? [];
  const submit = () => {
    if (!rows || !selected.size) return;
    const ready = rows
      .filter((row, index) => selected.has(index) && !row.errors.length)
      .map((row) => row.fields);
    if (ready.length) onSubmit(ready);
  };

  return (
    <div className="import-students">
      {!rows ? (
        <>
          <div className="import-instructions">
            <FileSpreadsheet size={24} />
            <div>
              <strong>从 Excel 复制，一次录入整个班</strong>
              <p>选中表格单元格，直接粘贴到下方。也可以每行只填写一个姓名。</p>
            </div>
          </div>
          <p className="field-hint">
            列顺序：姓名、年级、学校、家长、联系电话、备注。支持带表头的 CSV /
            TSV；带表头时可以调整列顺序。
          </p>
          {defaultGrade && (
            <p className="field-hint">
              未填写年级的学生将使用班级默认年级「{defaultGrade}」。
            </p>
          )}
          <label className="field">
            学生名单
            <textarea
              className="import-textarea"
              value={text}
              onChange={(event) => updateText(event.target.value)}
              rows={8}
              placeholder={
                "姓名\t年级\t学校\t家长\t联系电话\t备注\n张同学\t初一\t实验中学"
              }
              spellCheck={false}
            />
          </label>
          <div className="import-toolbar">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt"
              hidden
              onChange={(event) => {
                void readFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              className="button button-secondary button-sm"
              disabled={reading}
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={15} />
              {reading ? "正在读取…" : "选择 CSV 文件"}
            </button>
            <button
              type="button"
              className="button button-ghost button-sm"
              onClick={downloadTemplate}
            >
              <Download size={15} />
              下载模板
            </button>
            <button
              type="button"
              className="button button-ghost button-sm"
              onClick={() => updateText(IMPORT_SAMPLE)}
            >
              填入示例
            </button>
          </div>
          {fileName && <p className="field-hint">已读取：{fileName}</p>}
          <ErrorMessages errors={error ? [error] : []} />
          <div className="form-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={onCancel}
            >
              取消
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={reading || !text.trim()}
              onClick={preview}
            >
              预览名单
            </button>
          </div>
        </>
      ) : (
        <>
          <div
            ref={previewRef}
            tabIndex={-1}
            className="import-summary"
            aria-live="polite"
          >
            <strong>
              共识别 {rows.length} 行 · 已选择 {selected.size} 人
            </strong>
            <p>
              {invalidCount > 0
                ? `${invalidCount} 行信息有误，需返回修改。`
                : "信息检查完成。"}
              {duplicateCount > 0
                ? ` ${duplicateCount} 行可能重复，默认不勾选，请核对后决定。`
                : ""}
            </p>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={!validIndexes.length}
              onChange={() =>
                setSelected(allSelected ? new Set() : new Set(validIndexes))
              }
            />
            全选可导入行{duplicateCount > 0 ? "（包含可能重复的学生）" : ""}
          </label>
          <div className="import-preview">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">选择</th>
                  <th scope="col">原始行</th>
                  <th scope="col">姓名</th>
                  <th scope="col">年级</th>
                  <th scope="col">学校</th>
                  <th scope="col">家长</th>
                  <th scope="col">联系电话</th>
                  <th scope="col">备注</th>
                  <th scope="col">检查结果</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row, visibleIndex) => {
                  const index = page * pageSize + visibleIndex;
                  return (
                    <tr key={`${row.line}-${index}`}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`选择第 ${row.line} 行 ${row.fields.name || "未填写姓名"}`}
                          checked={selected.has(index)}
                          disabled={row.errors.length > 0}
                          onChange={() => toggle(index)}
                        />
                      </td>
                      <td>{row.line}</td>
                      <td>{row.fields.name || "—"}</td>
                      <td>{row.fields.grade || "—"}</td>
                      <td>{row.fields.school || "—"}</td>
                      <td>{row.fields.guardian || "—"}</td>
                      <td>{row.fields.phone || "—"}</td>
                      <td title={row.fields.notes}>
                        {row.fields.notes
                          ? `${row.fields.notes.slice(0, 24)}${row.fields.notes.length > 24 ? "…" : ""}`
                          : "—"}
                      </td>
                      <td>
                        {row.errors.length ? (
                          <span className="import-row-error">
                            {row.errors.join("；")}
                          </span>
                        ) : row.duplicate ? (
                          <span className="badge badge-amber">可能重复</span>
                        ) : (
                          <span className="badge badge-green">可导入</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pageCount > 1 && (
            <div className="import-toolbar" aria-label="导入预览分页">
              <span className="field-hint">
                第 {page + 1} / {pageCount} 页 · 每页最多 {pageSize} 行 ·
                选择状态跨页保留
              </span>
              <button
                type="button"
                className="button button-secondary button-sm"
                disabled={page === 0}
                onClick={() => setPage((current) => current - 1)}
              >
                上一页
              </button>
              <button
                type="button"
                className="button button-secondary button-sm"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((current) => current + 1)}
              >
                下一页
              </button>
            </div>
          )}
          {selectedDuplicates > 0 && (
            <p className="field-hint" role="status">
              已选择 {selectedDuplicates}{" "}
              条可能重复的记录，导入后会分别建立学生档案。
            </p>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setRows(null)}
            >
              <ArrowLeft size={16} />
              返回修改
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={!selected.size}
              onClick={submit}
            >
              <Check size={16} />
              确认导入 {selected.size} 人
            </button>
          </div>
        </>
      )}
    </div>
  );
}
