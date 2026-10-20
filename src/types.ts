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
}

export interface FeedbackSession {
  id: string;
  module: ModuleId;
  classId: string | null;
  studentId: string | null;
  lessonAt: string;
  entries: FeedbackEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface AppData {
  schemaVersion: 1;
  students: Student[];
  classes: ClassGroup[];
  records: TeachingNote[];
  feedbackSessions?: FeedbackSession[];
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
