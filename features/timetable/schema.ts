import { boolean, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";
import { sections, subjects } from "@smw/feature-academics/schema";

/** The bell schedule: one row per period or break of the school day. Times are "HH:MM" in 24-hour form. */
export const periods = pgTable("periods", {
  ...schoolColumns(),
  name: text("name").notNull(), // "Period 1", "Lunch"
  startsAt: text("starts_at").notNull(), // "08:00"
  endsAt: text("ends_at").notNull(), // "08:40"
  sortOrder: integer("sort_order").notNull(),
  isBreak: boolean("is_break").notNull().default(false),
}, (t) => [...tenant(t, "periods"), index("periods_order").on(t.schoolId, t.sortOrder)]);

/** One class in one section's week: day 1-6 (Mon-Sat) x period. */
export const timetableSlots = pgTable("timetable_slots", {
  ...schoolColumns(),
  sectionId: uuid("section_id").notNull().references(() => sections.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(),
  periodId: uuid("period_id").notNull().references(() => periods.id, { onDelete: "cascade" }),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  teacherId: uuid("teacher_id").references(() => users.id, { onDelete: "set null" }),
  room: text("room"),
}, (t) => [
  ...tenant(t, "timetable_slots"),
  uniqueIndex("timetable_slots_cell").on(t.sectionId, t.dayOfWeek, t.periodId),
  // A teacher cannot be in two sections at once. The service checks first (to name the other section); this is the safety net.
  uniqueIndex("timetable_slots_teacher_cell").on(t.teacherId, t.dayOfWeek, t.periodId),
]);
