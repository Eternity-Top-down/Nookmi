import type { Exam, ExamEntry, Student } from "./types";

export interface ExamBand {
  label: string;
  min: number;
  max: number;
  count: number;
}

export interface ExamSchoolGroup {
  school: string;
  maxScore: number;
  count: number;
  meanScore: number;
  meanRate: number;
}

export interface ExamSummary {
  total: number;
  count: number;
  pending: number;
  absent: number;
  meanRate: number | null;
  medianRate: number | null;
  meanScore: number | null;
  commonMaxScore: number | null;
  atLeast60: number;
  atLeast85: number;
  bands: ExamBand[];
  schoolGroups: ExamSchoolGroup[];
}

const validMaximum = (value: number): boolean => Number.isFinite(value) && value > 0 && value <= 1000;

/** A percentage (0–100), not a rank or a claim that different papers are equivalent. */
export function entryRate(entry: ExamEntry): number | null {
  return entry.status === "recorded" && typeof entry.score === "number" &&
    Number.isFinite(entry.score) && validMaximum(entry.maxScore) &&
    entry.score >= 0 && entry.score <= entry.maxScore
    ? (entry.score / entry.maxScore) * 100
    : null;
}

export function summarizeExam(exam: Exam): ExamSummary {
  const unique = [...new Map(exam.entries.map((entry) => [entry.studentId, entry])).values()];
  const scored = unique.flatMap((entry) => {
    const rate = entryRate(entry);
    return rate === null ? [] : [{ entry, rate }];
  });
  const count = scored.length;
  const rates = scored.map(({ rate }) => rate).sort((a, b) => a - b);
  const meanRate = count ? rates.reduce((sum, rate) => sum + rate, 0) / count : null;
  const commonMaxScore = count && scored.every(({ entry }) => entry.maxScore === scored[0].entry.maxScore)
    ? scored[0].entry.maxScore : null;
  const bands: ExamBand[] = [
    { label: "低于 60%", min: 0, max: 60, count: 0 },
    { label: "60%–不足 75%", min: 60, max: 75, count: 0 },
    { label: "75%–不足 85%", min: 75, max: 85, count: 0 },
    { label: "85%–100%", min: 85, max: 100, count: 0 },
  ];
  const groups = new Map<string, { school: string; maxScore: number; scores: number[]; rates: number[] }>();
  let atLeast60 = 0;
  let atLeast85 = 0;
  for (const { entry, rate } of scored) {
    const score = entry.score!;
    // Compare in score units to keep exact threshold scores out of the lower band.
    const scaled = score * 100;
    const band = scaled < entry.maxScore * 60 ? 0 : scaled < entry.maxScore * 75 ? 1 : scaled < entry.maxScore * 85 ? 2 : 3;
    bands[band].count++;
    if (scaled >= entry.maxScore * 60) atLeast60++;
    if (scaled >= entry.maxScore * 85) atLeast85++;
    const school = entry.school.trim();
    const key = JSON.stringify([school, entry.maxScore]);
    const group = groups.get(key) ?? { school, maxScore: entry.maxScore, scores: [], rates: [] };
    group.scores.push(score);
    group.rates.push(rate);
    groups.set(key, group);
  }
  return {
    total: unique.length,
    count,
    absent: unique.filter((entry) => entry.status === "absent").length,
    pending: unique.filter((entry) => entry.status !== "absent" && entryRate(entry) === null).length,
    meanRate,
    medianRate: count ? (rates[Math.floor((count - 1) / 2)] + rates[Math.floor(count / 2)]) / 2 : null,
    meanScore: commonMaxScore === null ? null : scored.reduce((sum, { entry }) => sum + entry.score!, 0) / count,
    commonMaxScore,
    atLeast60,
    atLeast85,
    bands,
    schoolGroups: [...groups.values()].map((group) => ({
      school: group.school,
      maxScore: group.maxScore,
      count: group.scores.length,
      meanScore: group.scores.reduce((sum, score) => sum + score, 0) / group.scores.length,
      meanRate: group.rates.reduce((sum, rate) => sum + rate, 0) / group.rates.length,
    })).sort((a, b) => a.school.localeCompare(b.school, "zh-CN") || a.maxScore - b.maxScore),
  };
}

export function sortExams(exams: Exam[]): Exam[] {
  return [...exams].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

export function previousExam(exams: Exam[], current: Exam): Exam | undefined {
  return sortExams(exams.filter((exam) => exam.id !== current.id && exam.classId === current.classId &&
    exam.subject.trim() === current.subject.trim() && exam.date < current.date))[0];
}

export interface ExamPasteRow {
  line: number;
  name: string;
  entry?: ExamEntry;
  errors: string[];
}

interface CellsRow { line: number; cells: string[]; errors: string[] }

function readCells(text: string): CellsRow[] {
  // A tab inside quoted text is data; use the first logical record to choose the separator.
  let quoted = false;
  let delimiter = ",";
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && char === "\t") { delimiter = "\t"; break; }
    else if (!quoted && char === "\n" && text.slice(0, index).trim()) break;
  }
  const rows: CellsRow[] = [];
  let field = "";
  let cells: string[] = [];
  let errors: string[] = [];
  let line = 1;
  let rowLine = 1;
  let inQuotes = false;
  let afterQuote = false;
  const finishCell = () => { cells.push(field.trim()); field = ""; afterQuote = false; };
  const finishRow = () => {
    finishCell();
    if (cells.some((cell) => cell !== "") || errors.length) rows.push({ line: rowLine, cells, errors });
    cells = []; errors = [];
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') { field += char; index++; }
      else if (char === '"') { inQuotes = false; afterQuote = true; }
      else { field += char; if (char === "\n") line++; }
    } else if (char === delimiter) finishCell();
    else if (char === "\n") { finishRow(); line++; rowLine = line; }
    else if (char === '"') {
      if (!field.trim() && !afterQuote) { field = ""; inQuotes = true; }
      else { errors.push("引号格式不正确，请重新复制单元格"); field += char; }
    } else if (afterQuote) {
      if (!/\s/.test(char)) { errors.push("结束引号后存在多余内容"); field += char; }
    } else field += char;
  }
  if (inQuotes) errors.push("双引号未闭合");
  finishRow();
  return rows;
}

const nameKey = (name: string) => name.trim().normalize("NFKC");
const numericText = (value: string): number | null => {
  const normalized = value.trim().normalize("NFKC");
  return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized) && Number.isFinite(Number(normalized)) ? Number(normalized) : null;
};
const headers: Record<string, "name" | "score" | "maxScore"> = {
  姓名: "name", 学生: "name", 学生姓名: "name", name: "name",
  成绩: "score", 分数: "score", 得分: "score", score: "score",
  满分: "maxScore", 总分: "maxScore", 试卷满分: "maxScore", maxscore: "maxScore",
};

/** Preview only: callers must reject a batch with errors before applying any entries. */
export function parseExamPaste(text: string, students: Student[], exam: Exam): ExamPasteRow[] {
  if (!text.trim()) return [];
  if (text.length > 1_000_000) return [{ line: 1, name: "", errors: ["粘贴内容过大，请分批录入（每次最多 1 MB 文本）"] }];
  const rows = readCells(text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"));
  if (!rows.length) return [];
  let columns: ("name" | "score" | "maxScore")[] = ["name", "score", "maxScore"];
  const candidate = rows[0].cells.map((cell) => {
    const key = cell.replace(/[\s_-]/g, "").toLowerCase();
    return Object.hasOwn(headers, key) ? headers[key] : undefined;
  });
  if (candidate.includes("name") || candidate.includes("score")) {
    if (rows[0].errors.length || !candidate.includes("name") || !candidate.includes("score") ||
      candidate.some((column) => !column) || new Set(candidate).size !== candidate.length) {
      return [{ line: rows[0].line, name: "", errors: ["表头请使用「姓名、成绩、满分」，姓名和成绩不可缺少或重复"] }];
    }
    columns = candidate as typeof columns;
    rows.shift();
  }
  const members = new Map<string, Student[]>();
  for (const student of students.filter((student) => student.module === "course" && student.classId === exam.classId)) {
    const key = nameKey(student.name);
    members.set(key, [...(members.get(key) ?? []), student]);
  }
  const entries = new Map(exam.entries.map((entry) => [entry.studentId, entry]));
  const parsed: ExamPasteRow[] = rows.map((row) => {
    const errors = [...row.errors];
    const name = row.cells[columns.indexOf("name")] ?? "";
    const scoreText = row.cells[columns.indexOf("score")] ?? "";
    const maximumText = row.cells[columns.indexOf("maxScore")] ?? "";
    const matches = members.get(nameKey(name)) ?? [];
    if (row.cells.length < 2) errors.push("请按「姓名、成绩、满分（可省略）」分列粘贴，列之间用 Tab 或逗号分隔");
    if (row.cells.length > columns.length) errors.push("列数过多，只支持姓名、成绩和可选的满分");
    if (!name.trim()) errors.push("缺少学生姓名");
    else if (matches.length === 0) errors.push("未找到本班学生，请核对姓名");
    else if (matches.length > 1) errors.push("本班存在同名学生，请在成绩表中分别录入");
    const student = matches.length === 1 ? matches[0] : undefined;
    const original = student ? entries.get(student.id) : undefined;
    const maxScore = maximumText ? numericText(maximumText) : original?.maxScore ?? exam.defaultMaxScore;
    if (maxScore === null || !validMaximum(maxScore)) errors.push("满分须为大于 0 且不超过 1000 的数字");
    const status = scoreText === "缺考" ? "absent" : ["", "未录", "未录入", "待录入", "—", "-"].includes(scoreText) ? "pending" : "recorded";
    const score = status === "recorded" ? numericText(scoreText) : null;
    if (status === "recorded" && score === null) errors.push("成绩须为非负数字，也可以填写「缺考」或「未录」");
    else if (score !== null && maxScore !== null && score > maxScore) errors.push(`成绩 ${score} 超过满分 ${maxScore}，请检查成绩或满分`);
    const entry = student && maxScore !== null && !errors.length ? {
      studentId: student.id,
      school: original?.school ?? student.school,
      maxScore,
      score,
      status,
    } satisfies ExamEntry : undefined;
    return { line: row.line, name, errors: [...new Set(errors)], ...(entry ? { entry } : {}) };
  });
  const seen = new Map<string, ExamPasteRow[]>();
  for (const row of parsed) {
    const key = nameKey(row.name);
    if (key) seen.set(key, [...(seen.get(key) ?? []), row]);
  }
  for (const matching of seen.values()) if (matching.length > 1) {
    for (const row of matching) {
      row.errors.push("这位学生在粘贴内容中重复出现，请只保留一行");
      delete row.entry;
    }
  }
  return parsed;
}

function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function exportExamCsv(exam: Exam, students: Student[]): string {
  const names = new Map(students.map((student) => [student.id, student.name]));
  const status = { pending: "未录入", absent: "缺考", recorded: "已录入" } as const;
  const rows: (string | number)[][] = [
    ["考试", "日期", "科目", "姓名", "学校", "成绩", "满分", "得分率（%）", "状态"],
    ...exam.entries.map((entry) => {
      const rate = entryRate(entry);
      return [exam.name, exam.date, exam.subject, names.get(entry.studentId) ?? entry.studentId, entry.school,
        rate === null ? "" : entry.score!, entry.maxScore, rate === null ? "" : Number(rate.toFixed(2)),
        rate === null && entry.status === "recorded" ? "待检查" : status[entry.status]];
    }),
  ];
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
