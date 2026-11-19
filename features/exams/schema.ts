import { boolean, date, index, integer, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant } from "@smw/db";
import { academicYears, classes, subjects, terms } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";

export const EXAM_KINDS = ["unit_test", "half_yearly", "annual", "other"] as const;
export const EXAM_STATUSES = ["draft", "scheduled", "marks_open", "published"] as const;
export const CO_SCHOLASTIC_GRADES = ["A", "B", "C"] as const;
export type ExamKind = (typeof EXAM_KINDS)[number];
export type ExamStatus = (typeof EXAM_STATUSES)[number];

export const gradeScales = pgTable("grade_scales", {
  ...schoolColumns(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
}, (t) => [...tenant(t, "grade_scales"), uniqueIndex("grade_scales_name").on(t.schoolId, t.name)]);

/** One grade of a scale: percent range (whole numbers, inclusive), grade point and the remark printed on report cards. */
export const gradeBands = pgTable("grade_bands", {
  ...schoolColumns(),
  scaleId: uuid("scale_id").notNull().references(() => gradeScales.id, { onDelete: "cascade" }),
  grade: text("grade").notNull(), // "A1"
  minPercent: integer("min_percent").notNull(),
  maxPercent: integer("max_percent").notNull(),
  gradePoint: integer("grade_point").notNull().default(0),
  remark: text("remark"),
}, (t) => [...tenant(t, "grade_bands"), index("grade_bands_scale").on(t.scaleId)]);

export const exams = pgTable("exams", {
  ...schoolColumns(),
  yearId: uuid("year_id").notNull().references(() => academicYears.id, { onDelete: "cascade" }),
  termId: uuid("term_id").references(() => terms.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  kind: text("kind").$type<ExamKind>().notNull().default("other"),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  status: text("status").$type<ExamStatus>().notNull().default("draft"),
}, (t) => [...tenant(t, "exams"), index("exams_year").on(t.schoolId, t.yearId)]);

/** One exam sitting: a subject for a class on a date. */
export const examPapers = pgTable("exam_papers", {
  ...schoolColumns(),
  examId: uuid("exam_id").notNull().references(() => exams.id, { onDelete: "cascade" }),
  classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  maxMarks: integer("max_marks").notNull(),
  passMarks: integer("pass_marks").notNull(),
}, (t) => [...tenant(t, "exam_papers"), uniqueIndex("exam_papers_unique").on(t.examId, t.classId, t.subjectId)]);

/** A student's mark on a paper. `marksObtained` null with `isAbsent` false means "not entered" (such rows are not stored). */
export const marks = pgTable("marks", {
  ...schoolColumns(),
  paperId: uuid("paper_id").notNull().references(() => examPapers.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  marksObtained: numeric("marks_obtained", { precision: 6, scale: 2, mode: "number" }),
  isAbsent: boolean("is_absent").notNull().default(false),
  /** users.id of whoever last saved it (soft reference). */
  enteredBy: uuid("entered_by"),
}, (t) => [...tenant(t, "marks"), uniqueIndex("marks_unique").on(t.paperId, t.studentId), index("marks_student").on(t.studentId)]);

export const coScholasticGrades = pgTable("co_scholastic_grades", {
  ...schoolColumns(),
  examId: uuid("exam_id").notNull().references(() => exams.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  grade: text("grade").$type<(typeof CO_SCHOLASTIC_GRADES)[number]>().notNull(),
}, (t) => [...tenant(t, "co_scholastic_grades"), uniqueIndex("co_scholastic_unique").on(t.examId, t.studentId, t.subjectId)]);
