// Contract tables for the academic structure. Other features read these (they list "academics" in requires).
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";

export const YEAR_STATUSES = ["planning", "active", "closed"] as const;
export const STAGES = ["pre_primary", "primary", "middle", "secondary", "senior_secondary"] as const;
export const SHIFTS = ["morning", "afternoon"] as const;
export const SUBJECT_TYPES = ["theory", "practical", "both"] as const;
export const HOUSE_TONES = ["default", "success", "warning", "danger", "info"] as const;

export const academicYears = pgTable("academic_years", {
  ...schoolColumns(),
  name: text("name").notNull(), // "2026-27"
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
  /** A closed year is read-only in this module: its terms, sections and subject teachers cannot change. */
  status: text("status").$type<(typeof YEAR_STATUSES)[number]>().notNull().default("active"),
}, (t) => [...tenant(t, "academic_years"), uniqueIndex("academic_years_name").on(t.schoolId, t.name),
  // at most one current year per school
  uniqueIndex("academic_years_current").on(t.schoolId).where(sql`${t.isCurrent}`)]);

export const terms = pgTable("terms", {
  ...schoolColumns(),
  yearId: uuid("year_id").notNull().references(() => academicYears.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // "Term 1"
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [...tenant(t, "terms"), index("terms_year").on(t.yearId)]);

/** A grade level that persists across years: Nursery (-2), LKG (-1), UKG (0), Class 1..12. */
export const classes = pgTable("classes", {
  ...schoolColumns(),
  name: text("name").notNull(),
  grade: integer("grade").notNull(),
  /** Position in lists; new classes take their grade. */
  displayOrder: integer("display_order").notNull().default(0),
  /** Unset means "derive it from the grade" (see stageOf in presets.ts). */
  stage: text("stage").$type<(typeof STAGES)[number]>(),
  /** Board when this class differs from the school's (CBSE, ICSE, State). */
  boardOverride: text("board_override"),
}, (t) => [...tenant(t, "classes"), uniqueIndex("classes_name").on(t.schoolId, t.name)]);

/** A division of a class in one academic year: "5-A" in 2026-27. Students and timetables hang off sections. */
export const sections = pgTable("sections", {
  ...schoolColumns(),
  classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
  yearId: uuid("year_id").notNull().references(() => academicYears.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // "A"
  capacity: integer("capacity").notNull().default(40),
  classTeacherId: uuid("class_teacher_id").references(() => users.id, { onDelete: "set null" }),
  room: text("room"),
  medium: text("medium"), // free text: English, Hindi, Bengali...
  shift: text("shift").$type<(typeof SHIFTS)[number]>(),
  /** Stream label for classes 11-12 ("Science", "Commerce"). */
  streamLabel: text("stream_label"),
}, (t) => [...tenant(t, "sections"), uniqueIndex("sections_unique").on(t.schoolId, t.yearId, t.classId, t.name)]);

export const SUBJECT_KINDS = ["scholastic", "co_scholastic"] as const;

export const subjects = pgTable("subjects", {
  ...schoolColumns(),
  name: text("name").notNull(),
  code: text("code"),
  kind: text("kind").$type<(typeof SUBJECT_KINDS)[number]>().notNull().default("scholastic"),
  shortName: text("short_name"),
  type: text("type").$type<(typeof SUBJECT_TYPES)[number]>().notNull().default("theory"),
  maxMarksTheory: integer("max_marks_theory"),
  maxMarksPractical: integer("max_marks_practical"),
  boardCode: text("board_code"),
  /** Colour on the timetable, from the same tones as houses. */
  tone: text("tone").$type<(typeof HOUSE_TONES)[number]>(),
  isLanguage: boolean("is_language").notNull().default(false),
}, (t) => [...tenant(t, "subjects"), uniqueIndex("subjects_name").on(t.schoolId, t.name)]);

/** Which subjects a class studies. */
export const classSubjects = pgTable("class_subjects", {
  ...schoolColumns(),
  classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  /** Elective: not studied by everyone; a student studies it only if it was chosen for them (student_subjects). */
  isElective: boolean("is_elective").notNull().default(false),
}, (t) => [...tenant(t, "class_subjects"), uniqueIndex("class_subjects_unique").on(t.classId, t.subjectId)]);

/** Who teaches a subject to a section (users with role teacher). */
export const sectionTeachers = pgTable("section_teachers", {
  ...schoolColumns(),
  sectionId: uuid("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  teacherId: uuid("teacher_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => [...tenant(t, "section_teachers"), uniqueIndex("section_teachers_unique").on(t.sectionId, t.subjectId), index("section_teachers_teacher").on(t.teacherId)]);

/** A stream or choice pack of a class: "Science PCM", "Second language". Its subjects are elective class subjects. */
export const subjectGroups = pgTable("subject_groups", {
  ...schoolColumns(),
  classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
}, (t) => [...tenant(t, "subject_groups"), uniqueIndex("subject_groups_unique").on(t.classId, t.name)]);

export const subjectGroupSubjects = pgTable("subject_group_subjects", {
  ...schoolColumns(),
  groupId: uuid("group_id").notNull().references(() => subjectGroups.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
}, (t) => [...tenant(t, "subject_group_subjects"), uniqueIndex("subject_group_subjects_unique").on(t.groupId, t.subjectId)]);

/** The elective subjects a student studies in a year. studentId has no foreign key: students depends on this feature, not the reverse. */
export const studentSubjects = pgTable("student_subjects", {
  ...schoolColumns(),
  studentId: uuid("student_id").notNull(),
  yearId: uuid("year_id").notNull().references(() => academicYears.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  /** The group the student was put in, when the subject came from one. */
  groupId: uuid("group_id").references(() => subjectGroups.id, { onDelete: "set null" }),
}, (t) => [...tenant(t, "student_subjects"), uniqueIndex("student_subjects_unique").on(t.studentId, t.yearId, t.subjectId), index("student_subjects_student").on(t.studentId, t.yearId)]);

export const houses = pgTable("houses", {
  ...schoolColumns(),
  name: text("name").notNull(),
  tone: text("tone").$type<(typeof HOUSE_TONES)[number]>().notNull().default("default"),
  /** Optional captain (a student id; no foreign key, see student_subjects). */
  captainStudentId: uuid("captain_student_id"),
}, (t) => [...tenant(t, "houses"), uniqueIndex("houses_name").on(t.schoolId, t.name)]);

/** A student is in at most one house. */
export const studentHouses = pgTable("student_houses", {
  ...schoolColumns(),
  studentId: uuid("student_id").notNull(),
  houseId: uuid("house_id").notNull().references(() => houses.id, { onDelete: "cascade" }),
}, (t) => [...tenant(t, "student_houses"), uniqueIndex("student_houses_student").on(t.schoolId, t.studentId), index("student_houses_house").on(t.houseId)]);

export const housePoints = pgTable("house_points", {
  ...schoolColumns(),
  houseId: uuid("house_id").notNull().references(() => houses.id, { onDelete: "cascade" }),
  points: integer("points").notNull(),
  reason: text("reason").notNull(),
  awardedBy: uuid("awarded_by").references(() => users.id, { onDelete: "set null" }),
  awardedOn: date("awarded_on").notNull(),
}, (t) => [...tenant(t, "house_points"), index("house_points_house").on(t.houseId)]);
