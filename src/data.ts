import {
  EMPTY_STUDENT,
  type AppData,
  type ClassGroup,
  type FeedbackBrief,
  type FeedbackEntry,
  type FeedbackSession,
  type ImportRow,
  type Student,
  type StudentFields,
  type StudentObservations,
  type TeachingNote,
} from "./types";

export const STORAGE_KEY = "nookmi:data:v1";
export const EMPTY_DATA: AppData = {
  schemaVersion: 1,
  students: [],
  classes: [],
  records: [],
};
const FIELD_ORDER: (keyof StudentFields)[] = [
  "name",
  "grade",
  "school",
  "guardian",
  "phone",
  "notes",
];
const LIMITS: Record<keyof StudentFields, number> = {
  name: 80,
  grade: 50,
  school: 120,
  guardian: 80,
  phone: 80,
  notes: 5000,
};
const FIELD_NAMES: Record<keyof StudentFields, string> = {
  name: "姓名",
  grade: "年级",
  school: "学校",
  guardian: "家长",
  phone: "联系电话",
  notes: "备注",
};

const HEADER_ALIASES: Record<string, keyof StudentFields> = {
  姓名: "name",
  学生: "name",
  学生姓名: "name",
  name: "name",
  studentname: "name",
  年级: "grade",
  grade: "grade",
  学校: "school",
  就读学校: "school",
  school: "school",
  家长: "guardian",
  家长姓名: "guardian",
  监护人: "guardian",
  guardian: "guardian",
  parent: "guardian",
  电话: "phone",
  手机: "phone",
  手机号: "phone",
  联系电话: "phone",
  家长电话: "phone",
  联系方式: "phone",
  phone: "phone",
  mobile: "phone",
  备注: "notes",
  学情备注: "notes",
  notes: "notes",
  note: "notes",
};

function emptyData(): AppData {
  return { schemaVersion: 1, students: [], classes: [], records: [] };
}

export function newId(): string {
  return crypto.randomUUID();
}

export function validateStudent(fields: StudentFields): string[] {
  const errors: string[] = [];
  if (!fields.name.trim()) errors.push("请填写学生姓名");
  for (const field of FIELD_ORDER) {
    if (fields[field].length > LIMITS[field])
      errors.push(`${FIELD_NAMES[field]}不能超过 ${LIMITS[field]} 个字符`);
  }
  return errors;
}

function duplicateKey(fields: StudentFields): string {
  return JSON.stringify([
    fields.name.trim().normalize("NFKC").toLocaleLowerCase(),
    fields.grade.trim().normalize("NFKC").toLocaleLowerCase(),
    fields.phone.replace(/[\s()-]/g, "").normalize("NFKC"),
  ]);
}

interface ParsedRow {
  line: number;
  cells: string[];
  errors: string[];
}

function detectDelimiter(text: string): string {
  let quoted = false;
  let commas = 0;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && char === "\t") {
      return "\t";
    } else if (!quoted && char === ",") {
      commas++;
    } else if (!quoted && char === "\n") {
      // The first non-empty logical record determines the file's format.
      if (text.slice(0, index).trim()) break;
    }
  }
  return commas ? "," : "\t";
}

function parseDelimited(text: string, delimiter: string): ParsedRow[] {
  const rows: ParsedRow[] = [];
  let cells: string[] = [];
  let errors: string[] = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;
  let line = 1;
  let rowLine = 1;
  const finishField = () => {
    cells.push(field.trim());
    field = "";
    afterQuote = false;
  };
  const finishRow = () => {
    finishField();
    if (cells.some((cell) => cell !== "") || errors.length)
      rows.push({ line: rowLine, cells, errors: [...new Set(errors)] });
    cells = [];
    errors = [];
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        inQuotes = false;
        afterQuote = true;
      } else {
        field += char;
        if (char === "\n") line++;
      }
    } else if (char === delimiter) {
      finishField();
    } else if (char === "\n") {
      finishRow();
      line++;
      rowLine = line;
    } else if (char === '"') {
      if (!field.trim() && !afterQuote) {
        field = "";
        inQuotes = true;
      } else {
        errors.push("引号格式错误，请使用英文双引号包裹完整单元格");
        field += char;
      }
    } else if (afterQuote) {
      if (!/\s/.test(char)) {
        errors.push("结束引号后存在多余字符");
        field += char;
      }
    } else {
      field += char;
    }
  }
  if (inQuotes) errors.push("双引号未闭合，请检查这一行");
  finishRow();
  return rows;
}

/**
 * CSV and Excel TSV share the same quoted-cell rules. An optional header may
 * reorder fields; without a header columns follow FIELD_ORDER.
 */
export function parseStudentImport(
  text: string,
  existing: Student[],
  defaultGrade = "",
): ImportRow[] {
  if (!text.trim()) return [];
  if (text.length > 5_000_000) {
    return [
      {
        line: 1,
        fields: { ...EMPTY_STUDENT },
        errors: ["名单过大，请分批导入（每次最多 5 MB 文本）"],
        duplicate: false,
      },
    ];
  }
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const rows = parseDelimited(normalized, detectDelimiter(normalized));
  if (!rows.length) return [];
  const header = rows[0].cells.map((cell) => {
    const key = cell.replace(/[\s_-]/g, "").toLocaleLowerCase();
    return Object.hasOwn(HEADER_ALIASES, key) ? HEADER_ALIASES[key] : undefined;
  });
  const recognized = header.filter(
    (field): field is keyof StudentFields => field !== undefined,
  );
  const hasHeader =
    Boolean(header[0]) ||
    recognized.includes("name") ||
    (recognized.length > 0 &&
      recognized.length === rows[0].cells.filter((cell) => cell !== "").length);
  let columns = FIELD_ORDER;
  if (hasHeader) {
    const errors = [...rows[0].errors];
    if (!recognized.includes("name")) errors.push("表头必须包含「姓名」列");
    if (header.some((field) => !field))
      errors.push(
        "存在无法识别的表头，请使用：姓名、年级、学校、家长、联系电话、备注",
      );
    if (new Set(recognized).size !== recognized.length)
      errors.push("表头有重复字段，请每个字段只保留一列");
    if (errors.length)
      return [
        {
          line: rows[0].line,
          fields: { ...EMPTY_STUDENT },
          errors,
          duplicate: false,
        },
      ];
    columns = recognized;
    rows.shift();
  }
  const seen = new Set(existing.map(duplicateKey));
  return rows.map((row) => {
    const fields: StudentFields = { ...EMPTY_STUDENT };
    row.cells.forEach((value, index) => {
      const field = columns[index];
      if (field) fields[field] = value;
    });
    if (!fields.grade) fields.grade = defaultGrade.trim();
    const errors = [...row.errors, ...validateStudent(fields)];
    if (row.cells.length > columns.length)
      errors.push(
        `列数过多：预期最多 ${columns.length} 列，实际 ${row.cells.length} 列`,
      );
    const key = duplicateKey(fields);
    const duplicate = seen.has(key);
    // Invalid rows cannot be imported and must not mark later valid rows as duplicates.
    if (!errors.length) seen.add(key);
    return { line: row.line, fields, errors, duplicate };
  });
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label}格式不正确`);
  return value as Record<string, unknown>;
}

function string(
  value: unknown,
  label: string,
  limit: number,
  required = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > limit ||
    (required && !value.trim())
  ) {
    throw new Error(
      `${label}必须是${required ? "非空" : ""}文本，且不超过 ${limit} 个字符`,
    );
  }
  return value;
}

function calendarDate(value: unknown, label: string): string {
  const date = string(value, label, 10, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new Error(`${label}应为 YYYY-MM-DD 格式`);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    throw new Error(`${label}不是有效日期`);
  return date;
}

function timestamp(value: unknown, label: string): string {
  const date = string(value, label, 40, true);
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      date,
    ) ||
    !Number.isFinite(Date.parse(date))
  ) {
    throw new Error(`${label}不是有效时间`);
  }
  calendarDate(date.slice(0, 10), label);
  return date;
}

function localDateTime(value: unknown, label: string): string {
  const date = string(value, label, 16, true);
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(date))
    throw new Error(`${label}应为有效的 YYYY-MM-DDTHH:mm 格式`);
  calendarDate(date.slice(0, 10), label);
  return date;
}

function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    throw new Error(`${label}必须是列表，且不能超过 ${max} 条`);
  return value;
}

function feedbackBrief(value: unknown): FeedbackBrief {
  const row = object(value, "反馈共用内容");
  const periodStart = calendarDate(row.periodStart, "反馈开始日期");
  const periodEnd = calendarDate(row.periodEnd, "反馈结束日期");
  if (
    periodStart < "1900-01-01" ||
    periodEnd > "2100-12-31" ||
    periodStart > periodEnd
  )
    throw new Error(
      "反馈起止日期须在 1900—2100 年内，且开始日期不能晚于结束日期",
    );
  const subjects = array(row.subjects, "反馈学科", 10).map((value) =>
    string(value, "反馈学科名称", 50, true).trim(),
  );
  if (new Set(subjects).size !== subjects.length)
    throw new Error("反馈学科不能重复");
  if (row.length !== "brief" && row.length !== "standard")
    throw new Error("反馈篇幅须为 brief 或 standard");
  return {
    periodStart,
    periodEnd,
    subjects,
    teachingContent: string(row.teachingContent, "共用教学内容", 5000),
    commonTasks: string(row.commonTasks, "共用作业任务", 5000),
    focus: string(row.focus, "本次反馈重点", 5000),
    length: row.length,
  };
}

function studentObservations(value: unknown): StudentObservations {
  const row = object(value, "学生事实");
  const rawSubjects = object(row.subjects, "分学科事实");
  const entries = Object.entries(rawSubjects);
  if (entries.length > 10) throw new Error("分学科事实不能超过 10 科");
  // A subject is user-supplied text: keep only own keys and never inherit
  // constructor / __proto__ when a later form looks up a missing subject.
  const subjects: Record<string, string> = Object.create(null);
  for (const [rawName, value] of entries) {
    const name = string(rawName, "事实学科名称", 50, true).trim();
    if (Object.hasOwn(subjects, name))
      throw new Error("分学科事实的学科名称不能重复");
    subjects[name] = string(value, "分学科事实内容", 2000);
  }
  return {
    performance: string(row.performance, "课堂表现事实", 2000),
    strengths: string(row.strengths, "进步与闪光点事实", 2000),
    difficulties: string(row.difficulties, "困难与问题事实", 2000),
    plan: string(row.plan, "后续建议事实", 2000),
    tasks: string(row.tasks, "作业任务事实", 2000),
    subjects,
  };
}

function hasBriefText(brief?: FeedbackBrief): boolean {
  return Boolean(
    brief &&
      [brief.teachingContent, brief.commonTasks, brief.focus].some((value) =>
        value.trim(),
      ),
  );
}

function hasEntryText(entry: FeedbackEntry): boolean {
  if (entry.content.trim()) return true;
  const observations = entry.observations;
  return Boolean(
    observations &&
      [
        observations.performance,
        observations.strengths,
        observations.difficulties,
        observations.plan,
        observations.tasks,
        ...Object.values(observations.subjects),
      ].some((value) => value.trim()),
  );
}

export function parseBackup(text: string): AppData {
  if (text.length > 20_000_000)
    throw new Error("备份文件过大（最多 20 MB），请检查文件是否正确");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("无法读取备份，请选择 Nookmi 导出的 JSON 文件");
  }
  const source = object(parsed, "备份");
  if (source.schemaVersion !== 1)
    throw new Error("不支持该备份版本，请使用 Nookmi 导出的兼容备份");
  const allIds = new Set<string>();
  const id = (value: unknown, label: string) => {
    const result = string(value, label, 128, true);
    // With the Unicode flag, a valid surrogate pair is a single code point.
    // Reject only lone surrogates, which cannot be encoded into a route URL.
    if (/[\uD800-\uDFFF]/u.test(result))
      throw new Error(`${label}包含无效 Unicode 字符，请检查备份文件`);
    if (allIds.has(result)) throw new Error("备份中存在重复 ID，请检查文件");
    allIds.add(result);
    return result;
  };
  const classes: ClassGroup[] = array(source.classes, "班级", 5000).map(
    (value) => {
      const row = object(value, "班级");
      if (row.module !== "evening" && row.module !== "course")
        throw new Error("班级模块必须是晚辅或班课");
      return {
        id: id(row.id, "班级 ID"),
        module: row.module,
        name: string(row.name, "班级名称", 100, true),
        grade: string(row.grade, "班级年级", 50),
        schedule: string(row.schedule, "上课安排", 200),
        notes: string(row.notes, "班级备注", 5000),
        createdAt: timestamp(row.createdAt, "班级创建时间"),
      };
    },
  );
  const classMap = new Map(classes.map((group) => [group.id, group]));
  const students: Student[] = array(source.students, "学生", 50_000).map(
    (value) => {
      const row = object(value, "学生");
      if (
        row.module !== "one-to-one" &&
        row.module !== "evening" &&
        row.module !== "course"
      )
        throw new Error("学生所属模块无效");
      const fields = Object.fromEntries(
        FIELD_ORDER.map((field) => [
          field,
          string(
            row[field],
            `学生${FIELD_NAMES[field]}`,
            LIMITS[field],
            field === "name",
          ),
        ]),
      ) as unknown as StudentFields;
      let classId: string | null = null;
      if (row.module === "one-to-one") {
        if (row.classId !== null) throw new Error("一对一学生不能属于班级");
      } else {
        classId = string(row.classId, "学生所属班级", 128, true);
        const group = classMap.get(classId);
        if (!group || group.module !== row.module)
          throw new Error("学生所属班级不存在，或与学生模块不一致");
      }
      return {
        ...fields,
        id: id(row.id, "学生 ID"),
        module: row.module,
        classId,
        createdAt: timestamp(row.createdAt, "学生创建时间"),
        updatedAt: timestamp(row.updatedAt, "学生更新时间"),
      };
    },
  );
  const studentIds = new Set(students.map((student) => student.id));
  const records: TeachingNote[] = array(
    source.records,
    "教学记录",
    100_000,
  ).map((value) => {
    const row = object(value, "教学记录");
    const studentId = string(row.studentId, "教学记录所属学生", 128, true);
    if (!studentIds.has(studentId)) throw new Error("教学记录所属学生不存在");
    return {
      id: id(row.id, "教学记录 ID"),
      studentId,
      date: calendarDate(row.date, "教学记录日期"),
      content: string(row.content, "教学记录内容", 10_000, true),
      createdAt: timestamp(row.createdAt, "教学记录创建时间"),
    };
  });
  const result: AppData = { schemaVersion: 1, students, classes, records };
  // Keep the original schema-v1 shape when restoring a pre-feedback backup.
  if (Object.hasOwn(source, "feedbackSessions")) {
    const studentMap = new Map(
      students.map((student) => [student.id, student]),
    );
    result.feedbackSessions = array(
      source.feedbackSessions,
      "课程反馈",
      20_000,
    ).map((value): FeedbackSession => {
      const row = object(value, "课程反馈");
      if (
        row.module !== "one-to-one" &&
        row.module !== "evening" &&
        row.module !== "course"
      )
        throw new Error("课程反馈所属模块无效");
      let classId: string | null = null;
      let studentId: string | null = null;
      if (row.module === "one-to-one") {
        if (row.classId !== null) throw new Error("一对一课程反馈不能属于班级");
        studentId = string(row.studentId, "课程反馈所属学生", 128, true);
        const target = studentMap.get(studentId);
        if (!target || target.module !== "one-to-one")
          throw new Error("课程反馈所属一对一学生不存在");
      } else {
        if (row.studentId !== null)
          throw new Error("班级课程反馈不能指定单独的目标学生");
        classId = string(row.classId, "课程反馈所属班级", 128, true);
        const target = classMap.get(classId);
        if (!target || target.module !== row.module)
          throw new Error("课程反馈所属班级不存在，或与反馈模块不一致");
      }
      const entryIds = new Set<string>();
      const entries = array(row.entries, "学生反馈", 50_000).map(
        (value): FeedbackEntry => {
          const entry = object(value, "学生反馈");
          const entryStudentId = string(
            entry.studentId,
            "学生反馈所属学生",
            128,
            true,
          );
          if (entryIds.has(entryStudentId))
            throw new Error("同一次课程反馈中存在重复学生");
          entryIds.add(entryStudentId);
          const target = studentMap.get(entryStudentId);
          if (
            !target ||
            target.module !== row.module ||
            (row.module === "one-to-one"
              ? entryStudentId !== studentId
              : target.classId !== classId)
          )
            throw new Error("学生反馈与课程反馈的目标学生或班级不一致");
          const result: FeedbackEntry = {
            studentId: entryStudentId,
            content: string(entry.content, "学生反馈内容", 10_000),
          };
          if (Object.hasOwn(entry, "observations"))
            result.observations = studentObservations(entry.observations);
          if (Object.hasOwn(entry, "reviewed")) {
            if (typeof entry.reviewed !== "boolean")
              throw new Error("反馈核对状态必须是布尔值");
            result.reviewed = entry.reviewed;
          }
          if (Object.hasOwn(entry, "generationSource")) {
            if (
              entry.generationSource !== "ai" &&
              entry.generationSource !== "manual" &&
              entry.generationSource !== "outline"
            )
              throw new Error("反馈生成来源须为 ai、manual 或 outline");
            result.generationSource = entry.generationSource;
          }
          if (Object.hasOwn(entry, "generatedFrom"))
            result.generatedFrom = string(
              entry.generatedFrom,
              "反馈生成依据标记",
              256,
            );
          return result;
        },
      );
      const brief = Object.hasOwn(row, "brief")
        ? feedbackBrief(row.brief)
        : undefined;
      if (row.module === "one-to-one" && entries.length !== 1)
        throw new Error("一对一课程反馈必须包含目标学生的一条反馈");
      if (!entries.some(hasEntryText) && !hasBriefText(brief))
        throw new Error("课程反馈至少需要非空反馈内容、学生事实或共用内容");
      return {
        id: id(row.id, "课程反馈 ID"),
        module: row.module,
        classId,
        studentId,
        lessonAt: localDateTime(row.lessonAt, "上课时间"),
        entries,
        ...(brief ? { brief } : {}),
        createdAt: timestamp(row.createdAt, "课程反馈创建时间"),
        updatedAt: timestamp(row.updatedAt, "课程反馈更新时间"),
      };
    });
  }
  return result;
}

export function pruneFeedbackForStudent(
  sessions: FeedbackSession[],
  studentId: string,
): FeedbackSession[] {
  return sessions.flatMap((session) => {
    if (session.module === "one-to-one" && session.studentId === studentId)
      return [];
    const entries = session.entries.filter(
      (entry) => entry.studentId !== studentId,
    );
    if (!entries.some(hasEntryText) && !hasBriefText(session.brief)) return [];
    return [
      entries.length === session.entries.length
        ? session
        : { ...session, entries },
    ];
  });
}

export function loadData(): { data: AppData; error: string | null } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return {
      data: stored === null ? emptyData() : parseBackup(stored),
      error: null,
    };
  } catch (error) {
    return {
      data: emptyData(),
      error: `本地数据暂时无法读取，原数据已保留。${error instanceof Error ? error.message : "请检查浏览器是否允许本地存储。"}`,
    };
  }
}

export function saveData(data: AppData): void {
  const serialized = JSON.stringify(data);
  // Check before overwriting an existing valid backup.
  parseBackup(serialized);
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    throw new Error(
      "无法保存：浏览器存储已满或不可用。请先导出备份，再释放空间或允许浏览器本地存储。",
    );
  }
}

export function createDemoData(): AppData {
  const current = new Date();
  const now = current.toISOString();
  const today = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
  const evening: ClassGroup = {
    id: newId(),
    module: "evening",
    name: "七年级晚辅 A 班",
    grade: "七年级",
    schedule: "周一至周五 · 18:30–20:30",
    notes: "示例班级，可自由修改。",
    createdAt: now,
  };
  const course: ClassGroup = {
    id: newId(),
    module: "course",
    name: "八年级数学提升班",
    grade: "八年级",
    schedule: "周六 · 09:00–11:00",
    notes: "示例班级，可自由修改。",
    createdAt: now,
  };
  const makeStudent = (
    name: string,
    grade: string,
    module: Student["module"],
    classId: string | null,
    notes: string,
  ): Student => ({
    ...EMPTY_STUDENT,
    id: newId(),
    name,
    grade,
    module,
    classId,
    school: "示例学校",
    notes,
    createdAt: now,
    updatedAt: now,
  });
  const students = [
    makeStudent(
      "林同学",
      "七年级",
      "one-to-one",
      null,
      "示例：计算习惯较好，下一步加强应用题的审题与表达。",
    ),
    makeStudent(
      "陈同学",
      "八年级",
      "one-to-one",
      null,
      "示例：关注几何证明的逻辑顺序。",
    ),
    makeStudent(
      "周同学",
      "九年级",
      "one-to-one",
      null,
      "示例：梳理二次函数的基础概念。",
    ),
    makeStudent(
      "许同学",
      "七年级",
      "evening",
      evening.id,
      "示例：每天记录作业完成情况。",
    ),
    makeStudent("陆同学", "七年级", "evening", evening.id, ""),
    makeStudent("江同学", "七年级", "evening", evening.id, ""),
    makeStudent("沈同学", "八年级", "course", course.id, ""),
    makeStudent("顾同学", "八年级", "course", course.id, ""),
    makeStudent("苏同学", "八年级", "course", course.id, ""),
  ];
  return {
    schemaVersion: 1,
    students,
    classes: [evening, course],
    records: [
      {
        id: newId(),
        studentId: students[0].id,
        date: today,
        content:
          "这是一条示例教学记录。\n本次内容：有理数运算与符号判断。\n下次关注：让学生口述每一步的计算依据。",
        createdAt: now,
      },
    ],
  };
}
