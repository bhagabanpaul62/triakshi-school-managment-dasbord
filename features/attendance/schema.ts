import { date, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";
import { sections } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { ATTENDANCE_STATUSES, STAFF_STATUSES } from "./constants";

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
