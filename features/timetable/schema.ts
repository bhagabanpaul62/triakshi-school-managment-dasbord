import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";
import { classes, sections, subjects } from "@smw/feature-academics/schema";

/** The bell schedule: one row per period or break of the school day. Times are "HH:MM" in 24-hour form. */
export const periods = pgTable("periods", {
  ...schoolColumns(),
  name: text("name").notNull(), // "Period 1", "Lunch"
  startsAt: text("starts_at").notNull(), // "08:00"
  endsAt: text("ends_at").notNull(), // "08:40"
  sortOrder: integer("sort_order").notNull(),
  isBreak: boolean("is_break").notNull().default(false),
}, (t) => [...tenant(t, "periods"), index("periods_order").on(t.schoolId, t.sortOrder)]);

/** A whole timetable: the live one every page reads, a draft being built, or an archived old live one. */
export const ttVersions = pgTable("tt_versions", {
  ...schoolColumns(),
  name: text("name").notNull(),
  status: text("status").$type<"draft" | "live" | "archived">().notNull().default("draft"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  /** What the generator could not place, and its numbers: { unplaced: [...], stats: {...}, seed }. */
  report: jsonb("report").$type<Record<string, unknown>>(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  /** A draft set to go live on this day (IST); the nightly job publishes it. Null = not scheduled. */
  publishOn: date("publish_on", { mode: "string" }),
}, (t) => [
  ...tenant(t, "tt_versions"),
  // At most one live version per school.
  uniqueIndex("tt_versions_one_live").on(t.schoolId).where(sql`${t.status} = 'live'`),
]);

/** One class in one section's week of one version: day 1-6 (Mon-Sat) x period. */
export const timetableSlots = pgTable("timetable_slots", {
  ...schoolColumns(),
  versionId: uuid("version_id").notNull().references(() => ttVersions.id, { onDelete: "cascade" }),
  sectionId: uuid("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(),
  periodId: uuid("period_id").notNull().references(() => periods.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  teacherId: uuid("teacher_id").references(() => users.id, { onDelete: "set null" }),
  room: text("room"),
  /** Pinned by the admin: a generator re-run leaves it alone. */
  locked: boolean("locked").notNull().default(false),
}, (t) => [
  ...tenant(t, "timetable_slots"),
  uniqueIndex("timetable_slots_cell").on(t.versionId, t.sectionId, t.dayOfWeek, t.periodId),
  // A teacher cannot be in two sections at once. The service checks first (to name the other section); this is the safety net.
  uniqueIndex("timetable_slots_teacher_cell").on(t.versionId, t.teacherId, t.dayOfWeek, t.periodId),
]);

/** Generator input 1+2: periods a week of a subject in a class, and how many back-to-back pairs of them. */
export const ttSubjectLoad = pgTable("tt_subject_load", {
  ...schoolColumns(),
  classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  periodsPerWeek: integer("periods_per_week").notNull(),
  doublePeriods: integer("double_periods").notNull().default(0),
  /** A kind of room the subject needs ("lab", "computer", "music"); null = any classroom. */
  roomKind: text("room_kind"),
}, (t) => [...tenant(t, "tt_subject_load"), uniqueIndex("tt_subject_load_unique").on(t.classId, t.subjectId)]);

/** Generator input 3+4: a teacher's limits and the cells they cannot teach. */
export const ttTeacherRules = pgTable("tt_teacher_rules", {
  ...schoolColumns(),
  teacherId: uuid("teacher_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  maxPerDay: integer("max_per_day"),
  maxPerWeek: integer("max_per_week"),
  unavailable: jsonb("unavailable").$type<{ day: number; periodId: string }[]>().notNull().default([]),
}, (t) => [...tenant(t, "tt_teacher_rules"), uniqueIndex("tt_teacher_rules_teacher").on(t.teacherId)]);

/** Generator input 5: labs and special rooms. Capacity is informational; the solver books a room per period. */
export const ttRooms = pgTable("tt_rooms", {
  ...schoolColumns(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  capacity: integer("capacity"),
}, (t) => [...tenant(t, "tt_rooms"), uniqueIndex("tt_rooms_name").on(t.schoolId, t.name)]);

/**
 * An elective block: alternative subjects taught at the SAME time to a class ("Second language": Hindi / Sanskrit / French).
 * Every section of the class is in the block at each of its periods; a student attends the option they chose (student_subjects).
 * Schema choice: a block's periods live in tt_block_slots (one row per class cell, not per section or option), so timetable_slots keeps its
 * "one subject, one teacher per section cell" unique rules untouched. A teacher's busy cells are timetable_slots rows plus the
 * tt_block_options of the blocks placed in tt_block_slots; the service and the solver check both, there is no cross-table DB constraint.
 */
export const ttBlocks = pgTable("tt_blocks", {
  ...schoolColumns(),
  classId: uuid("class_id").notNull().references(() => classes.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  periodsPerWeek: integer("periods_per_week").notNull(),
  doubles: integer("doubles").notNull().default(0),
}, (t) => [...tenant(t, "tt_blocks"), uniqueIndex("tt_blocks_name").on(t.classId, t.name)]);

/** One alternative of a block: its subject, its teacher, and optionally a fixed room from tt_rooms. */
export const ttBlockOptions = pgTable("tt_block_options", {
  ...schoolColumns(),
  blockId: uuid("block_id").notNull().references(() => ttBlocks.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  teacherId: uuid("teacher_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  roomId: uuid("room_id").references(() => ttRooms.id, { onDelete: "set null" }),
}, (t) => [...tenant(t, "tt_block_options"), uniqueIndex("tt_block_options_subject").on(t.blockId, t.subjectId)]);

/** A block placed at a day and period of a version: the whole class is in it, every option runs. */
export const ttBlockSlots = pgTable("tt_block_slots", {
  ...schoolColumns(),
  versionId: uuid("version_id").notNull().references(() => ttVersions.id, { onDelete: "cascade" }),
  blockId: uuid("block_id").notNull().references(() => ttBlocks.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(),
  periodId: uuid("period_id").notNull().references(() => periods.id, { onDelete: "cascade" }),
  locked: boolean("locked").notNull().default(false),
}, (t) => [...tenant(t, "tt_block_slots"), uniqueIndex("tt_block_slots_cell").on(t.versionId, t.blockId, t.dayOfWeek, t.periodId)]);

/** Generator inputs 6+7. One row per school; no row = both on. */
export const ttSettings = pgTable("tt_settings", {
  ...schoolColumns(),
  classTeacherFirstPeriod: boolean("class_teacher_first_period").notNull().default(true),
  noSameSubjectTwiceADay: boolean("no_same_subject_twice_a_day").notNull().default(true),
}, (t) => [...tenant(t, "tt_settings"), uniqueIndex("tt_settings_school").on(t.schoolId)]);

/** A cover: another teacher takes an absent teacher's period on one date. */
export const substitutions = pgTable("substitutions", {
  ...schoolColumns(),
  date: date("date").notNull(),
  /** A normal period. Null for the cover of an elective block, which sets blockSlotId and optionId instead. */
  slotId: uuid("slot_id").references(() => timetableSlots.id, { onDelete: "cascade" }),
  blockSlotId: uuid("block_slot_id").references(() => ttBlockSlots.id, { onDelete: "cascade" }),
  /** Which of the block's alternatives (and so which teacher) is covered. */
  optionId: uuid("option_id").references(() => ttBlockOptions.id, { onDelete: "cascade" }),
  absentTeacherId: uuid("absent_teacher_id").references(() => users.id, { onDelete: "set null" }),
  coverTeacherId: uuid("cover_teacher_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  note: text("note"),
}, (t) => [
  ...tenant(t, "substitutions"),
  uniqueIndex("substitutions_slot_date").on(t.slotId, t.date),
  uniqueIndex("substitutions_block_date").on(t.blockSlotId, t.optionId, t.date),
  index("substitutions_date").on(t.schoolId, t.date),
]);

/** A date that runs a different bell schedule (exam day, half day): only the listed periods are held. */
export const ttDayOverrides = pgTable("tt_day_overrides", {
  ...schoolColumns(),
  date: date("date").notNull(),
  label: text("label").notNull(),
  periodIds: jsonb("period_ids").$type<string[]>().notNull().default([]),
}, (t) => [...tenant(t, "tt_day_overrides"), uniqueIndex("tt_day_overrides_date").on(t.schoolId, t.date)]);
