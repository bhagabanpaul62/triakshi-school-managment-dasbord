import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant } from "@smw/db";

export const EVENT_AUDIENCES = ["all", "staff", "students", "parents", "class"] as const;
/** The name of a colour tone, never a hex: the UI maps it through the kit's TONE. */
export const EVENT_TONES = ["default", "info", "success", "warning"] as const;

export const events = pgTable("events", {
  ...schoolColumns(),
  title: text("title").notNull(),
  description: text("description"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  /** Null for a single moment. For all-day events: the last instant of the last day (IST). */
  endsAt: timestamp("ends_at", { withTimezone: true }),
  allDay: boolean("all_day").notNull().default(false),
  location: text("location"),
  audience: text("audience").$type<(typeof EVENT_AUDIENCES)[number]>().notNull().default("all"),
  /** Set when audience = class. Soft reference to academics.classes (this feature does not require academics). */
  classId: uuid("class_id"),
  isPublic: boolean("is_public").notNull().default(false),
  /** School closed. Attendance and timetable may read these. */
  isHoliday: boolean("is_holiday").notNull().default(false),
  tone: text("tone").$type<(typeof EVENT_TONES)[number]>().notNull().default("default"),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "events"), index("events_school_starts").on(t.schoolId, t.startsAt)]);
