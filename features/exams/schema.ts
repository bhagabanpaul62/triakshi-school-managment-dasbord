import { boolean, date, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant } from "@smw/db";
import { academicYears, classes, subjects, terms } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";

export const EXAM_KINDS = ["unit_test", "half_yearly", "annual", "other"] as const;
export const EXAM_STATUSES = ["draft", "scheduled", "marks_open", "published"] as const;
export const CO_SCHOLASTIC_GRADES = ["A", "B", "C"] as const;
export const CLASS_BANDS = ["1-5", "6-8", "9-10", "11-12"] as const;
export const BOARDS = ["cbse", "icse", "state"] as const;
export type ClassBand = (typeof CLASS_BANDS)[number];
export type Board = (typeof BOARDS)[number];
export interface CoGrade { grade: string; description: string }
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
  /** Date sheet: "HH:MM" (24 h). Both empty means the time is not set yet. */
  startTime: text("start_time"),
  endTime: text("end_time"),
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

/** A co-scholastic grade for a term (art, sports, discipline...). `examId` is only set on rows written before grades were keyed by term (exams without a term). */
export const coScholasticGrades = pgTable("co_scholastic_grades", {
  ...schoolColumns(),
  examId: uuid("exam_id").references(() => exams.id, { onDelete: "cascade" }),
  termId: uuid("term_id").references(() => terms.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  grade: text("grade").notNull(),
}, (t) => [
  ...tenant(t, "co_scholastic_grades"),
  uniqueIndex("co_scholastic_unique").on(t.examId, t.studentId, t.subjectId),
  uniqueIndex("co_scholastic_term_unique").on(t.termId, t.studentId, t.subjectId),
]);

/** A co-scholastic scale: the grades a teacher may pick (A/B/C...) with what each means. */
export const coScholasticScales = pgTable("co_scholastic_scales", {
  ...schoolColumns(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  grades: jsonb("grades").$type<CoGrade[]>().notNull(),
}, (t) => [...tenant(t, "co_scholastic_scales"), uniqueIndex("co_scholastic_scales_name").on(t.schoolId, t.name)]);

/** Report card setup per class band. `options.termSplit` is the final-result split by term order (e.g. [40, 60]); empty = plain average. */
export const reportTemplates = pgTable("report_templates", {
  ...schoolColumns(),
  classBand: text("class_band").$type<ClassBand>().notNull(),
  board: text("board").$type<Board>().notNull().default("cbse"),
  scaleId: uuid("scale_id").references(() => gradeScales.id, { onDelete: "set null" }),
  coScaleId: uuid("co_scale_id").references(() => coScholasticScales.id, { onDelete: "set null" }),
  showGrade: boolean("show_grade").notNull().default(true),
  showRank: boolean("show_rank").notNull().default(true),
  options: jsonb("options").$type<{ termSplit?: number[] }>().notNull().default({}),
}, (t) => [...tenant(t, "report_templates"), uniqueIndex("report_templates_band").on(t.schoolId, t.classBand)]);

/** Parts of a paper, e.g. Theory 80 + Internal 20. The paper's max marks is their sum. */
export const paperComponents = pgTable("paper_components", {
  ...schoolColumns(),
  paperId: uuid("paper_id").notNull().references(() => examPapers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  maxMarks: integer("max_marks").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [...tenant(t, "paper_components"), uniqueIndex("paper_components_name").on(t.paperId, t.name)]);

export const componentMarks = pgTable("component_marks", {
  ...schoolColumns(),
  componentId: uuid("component_id").notNull().references(() => paperComponents.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  marks: numeric("marks", { precision: 6, scale: 2, mode: "number" }),
  isAbsent: boolean("is_absent").notNull().default(false),
}, (t) => [...tenant(t, "component_marks"), uniqueIndex("component_marks_unique").on(t.componentId, t.studentId), index("component_marks_student").on(t.studentId)]);

/** How much an exam counts in its term's total (a term's weights add up to 100). */
export const termWeights = pgTable("term_weights", {
  ...schoolColumns(),
  termId: uuid("term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
  examId: uuid("exam_id").notNull().references(() => exams.id, { onDelete: "cascade" }),
  weightPercent: integer("weight_percent").notNull(),
}, (t) => [...tenant(t, "term_weights"), uniqueIndex("term_weights_unique").on(t.termId, t.examId)]);

/** The class teacher's remark for a student in a term, printed on the report card. */
export const reportRemarks = pgTable("report_remarks", {
  ...schoolColumns(),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  termId: uuid("term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  /** users.id of whoever wrote it (soft reference). */
  byUserId: uuid("by_user_id"),
}, (t) => [...tenant(t, "report_remarks"), uniqueIndex("report_remarks_unique").on(t.studentId, t.termId)]);
