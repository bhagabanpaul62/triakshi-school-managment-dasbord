// Contract tables for the academic structure. Other features read these (they list "academics" in requires).
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";

export const academicYears = pgTable("academic_years", {
  ...schoolColumns(),
  name: text("name").notNull(), // "2026-27"
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  isCurrent: boolean("is_current").notNull().default(false),
}, (t) => [...tenant(t, "academic_years"), uniqueIndex("academic_years_name").on(t.schoolId, t.name),
  // at most one current year per school
  uniqueIndex("academic_years_current").on(t.schoolId).where(sql`${t.isCurrent}`)]);

export const terms = pgTable("terms", {
  ...schoolColumns(),
  yearId: uuid("year_id").notNull().references(() => academicYears.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // "Term 1"
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
}, (t) => [...tenant(t, "terms"), index("terms_year").on(t.yearId)]);

/** A grade level that persists across years: Nursery (-2), LKG (-1), UKG (0), Class 1..12. */
export const classes = pgTable("classes", {
  ...schoolColumns(),
  name: text("name").notNull(),
  grade: integer("grade").notNull(),
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
}, (t) => [...tenant(t, "sections"), uniqueIndex("sections_unique").on(t.schoolId, t.yearId, t.classId, t.name)]);

export const SUBJECT_KINDS = ["scholastic", "co_scholastic"] as const;

export const subjects = pgTable("subjects", {
  ...schoolColumns(),
  name: text("name").notNull(),
  code: text("code"),
  kind: text("kind").$type<(typeof SUBJECT_KINDS)[number]>().notNull().default("scholastic"),
}, (t) => [...tenant(t, "subjects"), uniqueIndex("subjects_name").on(t.schoolId, t.name)]);

/** Which subjects a class studies. */
export const classSubjects = pgTable("class_subjects", {
  ...schoolColumns(),
  classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
}, (t) => [...tenant(t, "class_subjects"), uniqueIndex("class_subjects_unique").on(t.classId, t.subjectId)]);

/** Who teaches a subject to a section (users with role teacher). */
export const sectionTeachers = pgTable("section_teachers", {
  ...schoolColumns(),
  sectionId: uuid("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  teacherId: uuid("teacher_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => [...tenant(t, "section_teachers"), uniqueIndex("section_teachers_unique").on(t.sectionId, t.subjectId), index("section_teachers_teacher").on(t.teacherId)]);
