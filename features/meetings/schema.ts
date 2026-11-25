import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";
import type { Audience } from "@smw/feature-notifications/audience-rules";
import { students } from "@smw/feature-students/schema";
import type { MeetingState, SlotState, VisitState } from "./constants";

export const meetingDays = pgTable("meeting_days", {
  ...schoolColumns(),
  title: text("title").notNull(),
  note: text("note"),
  state: text("state").$type<MeetingState>().notNull().default("draft"),
  audience: jsonb("audience").$type<Audience>().notNull(),
  slotMinutes: smallint("slot_minutes").notNull().default(10),
  /** How many teachers one family may book for one child. */
  perFamily: smallint("per_family").notNull().default(6),
  opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
  closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [...tenant(t, "meeting_days"), index("meeting_days_state").on(t.schoolId, t.state)]);

export const meetingWindows = pgTable("meeting_windows", {
  ...schoolColumns(),
  meetingId: uuid("meeting_id").notNull().references(() => meetingDays.id, { onDelete: "cascade" }),
  teacherId: uuid("teacher_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  day: date("day").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  place: text("place"),
  videoUrl: text("video_url"),
}, (t) => [...tenant(t, "meeting_windows"), index("meeting_windows_meeting").on(t.meetingId, t.teacherId)]);

export const meetingSlots = pgTable("meeting_slots", {
  ...schoolColumns(),
  meetingId: uuid("meeting_id").notNull().references(() => meetingDays.id, { onDelete: "restrict" }),
  windowId: uuid("window_id").notNull().references(() => meetingWindows.id, { onDelete: "restrict" }),
  teacherId: uuid("teacher_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  /** break: kept free by the teacher. removed: its window changed. */
  state: text("state").$type<SlotState>().notNull().default("open"),
  studentId: uuid("student_id").references(() => students.id, { onDelete: "restrict" }),
  bookedBy: uuid("booked_by"),
  bookedAt: timestamp("booked_at", { withTimezone: true }),
  walkIn: boolean("walk_in").notNull().default(false),
  visit: text("visit").$type<VisitState>(),
  /** Seen by staff only. */
  privateNote: text("private_note"),
  /** Seen by the family after the meeting. */
  sharedRemark: text("shared_remark"),
  remindedDay: boolean("reminded_day").notNull().default(false),
  remindedHour: boolean("reminded_hour").notNull().default(false),
}, (t) => [...tenant(t, "meeting_slots"), index("meeting_slots_meeting").on(t.meetingId, t.teacherId, t.startsAt),
  uniqueIndex("meeting_slots_teacher_time").on(t.teacherId, t.startsAt).where(sql`${t.state} <> 'removed' and not ${t.walkIn}`),
  // one booking per child and teacher in a meeting, and one place at a time
  uniqueIndex("meeting_slots_child_teacher").on(t.meetingId, t.teacherId, t.studentId).where(sql`${t.state} = 'booked'`),
  uniqueIndex("meeting_slots_child_time").on(t.studentId, t.startsAt).where(sql`${t.state} = 'booked'`)]);

export const meetingWaits = pgTable("meeting_waits", {
  ...schoolColumns(),
  meetingId: uuid("meeting_id").notNull().references(() => meetingDays.id, { onDelete: "cascade" }),
  teacherId: uuid("teacher_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  sort: integer("sort").notNull().default(0),
}, (t) => [...tenant(t, "meeting_waits"), uniqueIndex("meeting_waits_unique").on(t.meetingId, t.teacherId, t.studentId)]);
