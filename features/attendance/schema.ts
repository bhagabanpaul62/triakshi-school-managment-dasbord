import { sql } from "drizzle-orm";
import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";
import { academicYears, sections, subjects } from "@smw/feature-academics/schema";
import { periods, timetableSlots, ttBlockOptions, ttBlockSlots } from "@smw/feature-timetable/schema";
import { students } from "@smw/feature-students/schema";
import { ATTENDANCE_MODES, ATTENDANCE_STATUSES, CONDONATION_REASONS, LEAVE_KINDS, LEAVE_STATUSES, STAFF_STATUSES } from "./constants";

export { ATTENDANCE_STATUSES, STAFF_STATUSES };

export const studentAttendance = pgTable("student_attendance", {
  ...schoolColumns(),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  sectionId: uuid("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  status: text("status").$type<(typeof ATTENDANCE_STATUSES)[number]>().notNull(),
  markedBy: uuid("marked_by"),
  note: text("note"),
}, (t) => [
  ...tenant(t, "student_attendance"),
  uniqueIndex("student_attendance_student_date").on(t.studentId, t.date),
  index("student_attendance_section_date").on(t.schoolId, t.sectionId, t.date),
]);

/**
 * One student in one period of one day, marked by the teacher who took it (or covered it). In period mode the day's
 * `student_attendance` row is worked out from these. The slot ids say which timetable cell it was; they go null if the
 * timetable is rebuilt, the mark itself stays. A block period lists students of several sections, so `sectionId` is the student's own.
 */
export const periodAttendance = pgTable("period_attendance", {
  ...schoolColumns(),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  sectionId: uuid("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  periodId: uuid("period_id").notNull().references(() => periods.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  slotId: uuid("slot_id").references(() => timetableSlots.id, { onDelete: "set null" }),
  blockSlotId: uuid("block_slot_id").references(() => ttBlockSlots.id, { onDelete: "set null" }),
  optionId: uuid("option_id").references(() => ttBlockOptions.id, { onDelete: "set null" }),
  status: text("status").$type<(typeof ATTENDANCE_STATUSES)[number]>().notNull(),
  markedBy: uuid("marked_by"),
}, (t) => [
  ...tenant(t, "period_attendance"),
  uniqueIndex("period_attendance_student_date_period").on(t.studentId, t.date, t.periodId),
  index("period_attendance_section_date").on(t.schoolId, t.sectionId, t.date),
  index("period_attendance_subject").on(t.schoolId, t.subjectId, t.date),
]);

export const staffAttendance = pgTable("staff_attendance", {
  ...schoolColumns(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  status: text("status").$type<(typeof STAFF_STATUSES)[number]>().notNull(),
  markedBy: uuid("marked_by"),
  note: text("note"),
}, (t) => [
  ...tenant(t, "staff_attendance"),
  uniqueIndex("staff_attendance_user_date").on(t.userId, t.date),
  index("staff_attendance_date").on(t.schoolId, t.date),
]);

/** Days the school is closed: nobody can be marked on them. */
export const attendanceHolidays = pgTable("attendance_holidays", {
  ...schoolColumns(),
  date: date("date").notNull(),
  name: text("name").notNull(),
}, (t) => [...tenant(t, "attendance_holidays"), uniqueIndex("attendance_holidays_date").on(t.schoolId, t.date)]);

/** One row per school: alerts on/off and the eligibility threshold. No row = the defaults. */
export const attendanceSettings = pgTable("attendance_settings", {
  ...schoolColumns(),
  alertsEnabled: boolean("alerts_enabled").notNull().default(true),
  thresholdPercent: integer("threshold_percent").notNull().default(75),
  mode: text("mode").$type<(typeof ATTENDANCE_MODES)[number]>().notNull().default("daily"),
  /** Period mode: present for the day when present or late in at least this % of the periods marked. */
  rollupPercent: integer("rollup_percent").notNull().default(50),
}, (t) => [...tenant(t, "attendance_settings"), uniqueIndex("attendance_settings_school").on(t.schoolId)]);

/** The sent-marker: one row per student and date means that day's absence alert already went out. */
/**
 * One absence alert per student and date. Marking queues it; the worker sends it once the grace window has passed
 * and the student is still absent or late (a corrected mistake never reaches the family). `sentAt` set = done.
 */
export const absenceAlerts = pgTable("absence_alerts", {
  ...schoolColumns(),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, (t) => [...tenant(t, "absence_alerts"), uniqueIndex("absence_alerts_student_date").on(t.studentId, t.date), index("absence_alerts_unsent").on(t.queuedAt).where(sql`${t.sentAt} is null`)]);

/** A student's or a staff member's request for leave, decided by the class teacher or the admin. */
export const leaveRequests = pgTable("leave_requests", {
  ...schoolColumns(),
  kind: text("kind").$type<(typeof LEAVE_KINDS)[number]>().notNull(),
  studentId: uuid("student_id").references(() => students.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  /** The login that applied; the decision notice goes here. */
  requestedBy: uuid("requested_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  fromDate: date("from_date").notNull(),
  toDate: date("to_date").notNull(),
  reason: text("reason").notNull(),
  /** Optional supporting file (S3 key; shown through a signed URL). */
  fileKey: text("file_key"),
  fileName: text("file_name"),
  status: text("status").$type<(typeof LEAVE_STATUSES)[number]>().notNull().default("pending"),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  note: text("note"),
  /** Set when an approver turned an earlier decision around; the audit log holds the before and after. */
  reversedBy: uuid("reversed_by").references(() => users.id, { onDelete: "set null" }),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
}, (t) => [
  ...tenant(t, "leave_requests"),
  index("leave_requests_status").on(t.schoolId, t.status, t.fromDate),
  index("leave_requests_requester").on(t.requestedBy),
]);

/** A board-eligibility exception (medical, sports, other) for one student in one academic year. */
export const attendanceCondonations = pgTable("attendance_condonations", {
  ...schoolColumns(),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  yearId: uuid("year_id").notNull().references(() => academicYears.id, { onDelete: "cascade" }),
  reason: text("reason").$type<(typeof CONDONATION_REASONS)[number]>().notNull(),
  note: text("note"),
  fileKey: text("file_key"),
  fileName: text("file_name"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [...tenant(t, "attendance_condonations"), uniqueIndex("attendance_condonations_student_year").on(t.studentId, t.yearId)]);
