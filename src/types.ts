export type ModuleId = "one-to-one" | "evening" | "course";

export interface StudentFields {
  name: string;
  grade: string;
  school: string;
  guardian: string;
  phone: string;
  notes: string;
}

export interface Student extends StudentFields {
  id: string;
  module: ModuleId;
  classId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClassGroup {
  id: string;
  module: "evening" | "course";
  name: string;
  grade: string;
  schedule: string;
  notes: string;
  createdAt: string;
}

export interface TeachingNote {
  id: string;
  studentId: string;
  date: string;
  content: string;
  createdAt: string;
}

export interface FeedbackEntry {
  studentId: string;
  content: string;
  observations?: StudentObservations;
  reviewed?: boolean;
  generationSource?: "ai" | "manual" | "outline";
  generatedFrom?: string;
  /** The single source behind the current editor text, retained for recovery. */
  aiDraft?: FeedbackAIDraft;
  /** The most recent explicitly adopted version; never a generation log. */
  comparison?: FeedbackComparison;
}

export interface StudentObservations {
  performance: string;
  strengths: string;
  difficulties: string;
  plan: string;
  tasks: string;
  subjects: Record<string, string>;
}

export interface FeedbackBrief {
  periodStart: string;
  periodEnd: string;
  subjects: string[];
  teachingContent: string;
  commonTasks: string;
  focus: string;
  length: "brief" | "standard";
}

export interface FeedbackInputSnapshot {
  module: ModuleId;
  grade: string;
  lessonAt: string;
  brief: FeedbackBrief;
  observations: StudentObservations;
}

export interface FeedbackAIDraft {
  id: string;
  sessionId: string;
  studentId: string;
  content: string;
  input: FeedbackInputSnapshot;
  createdAt: string;
  model: string;
}

export interface FeedbackComparison {
  source: FeedbackAIDraft;
  finalContent: string;
  finalInput: FeedbackInputSnapshot;
  confirmedAt: string;
}

export interface FeedbackSession {
  id: string;
  module: ModuleId;
  classId: string | null;
  studentId: string | null;
  lessonAt: string;
  lessonNumber?: number;
  title?: string;
  entries: FeedbackEntry[];
  brief?: FeedbackBrief;
  createdAt: string;
  updatedAt: string;
}

export interface ExamEntry {
  studentId: string;
  /** School at the time of this exam, independent of later profile edits. */
  school: string;
  maxScore: number;
  score: number | null;
  status: "pending" | "recorded" | "absent";
}

export interface Exam {
  id: string;
  classId: string;
  name: string;
  subject: string;
  date: string;
  defaultMaxScore: number;
  entries: ExamEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface AppData {
  schemaVersion: 1;
  students: Student[];
  classes: ClassGroup[];
  records: TeachingNote[];
  feedbackSessions?: FeedbackSession[];
  feedbackStyles?: Partial<Record<ModuleId, string>>;
  exams?: Exam[];
}

export interface ImportRow {
  line: number;
  fields: StudentFields;
  errors: string[];
  duplicate: boolean;
}

export const EMPTY_STUDENT: StudentFields = {
  name: "",
  grade: "",
  school: "",
  guardian: "",
  phone: "",
  notes: "",
};
