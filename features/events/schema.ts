import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";
import type { Audience } from "@smw/feature-notifications/audience-rules";
import type { EventState, EventType, RsvpAnswer, RsvpSpec } from "./constants";

/** Days the school is closed are not here: attendance_holidays (attendance module) is the one store. The calendar shows them as a layer. */
export const events = pgTable("events", {
  ...schoolColumns(),
  type: text("type").$type<EventType>().notNull().default("event"),
  state: text("state").$type<EventState>().notNull().default("live"),
  title: text("title").notNull(),
  description: text("description"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  /** Null for a single moment. For all-day events: the last instant of the last day (IST). */
  endsAt: timestamp("ends_at", { withTimezone: true }),
  allDay: boolean("all_day").notNull().default(false),
  location: text("location"),
  mapUrl: text("map_url"),
  bring: text("bring"),
  audience: jsonb("audience").$type<Audience>().notNull(),
  audienceLabel: text("audience_label").notNull().default(""),
  isPublic: boolean("is_public").notNull().default(false),
  ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
  /** Minutes before the start, e.g. [1440, 120]. */
  reminders: jsonb("reminders").$type<number[]>().notNull().default([1440, 120]),
  remindedFor: jsonb("reminded_for").$type<number[]>().notNull().default([]),
  rsvp: jsonb("rsvp").$type<RsvpSpec>().notNull().default({ on: false }),
  seriesId: uuid("series_id"),
  /** iCalendar SEQUENCE: goes up on every change people must see. */
  sequence: integer("sequence").notNull().default(0),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  /** A trip's consent notice: an app path. */
  consentHref: text("consent_href"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [...tenant(t, "events"), index("events_school_starts").on(t.schoolId, t.startsAt), index("events_series").on(t.seriesId)]);

/** Who an event is for, frozen when it goes live. */
export const eventPeople = pgTable("event_people", {
  ...schoolColumns(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  personKey: text("person_key").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  studentId: uuid("student_id"),
  name: text("name").notNull(),
  label: text("label").notNull().default(""),
  answer: text("answer").$type<RsvpAnswer>(),
  guests: integer("guests").notNull().default(0),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  waitingSince: timestamp("waiting_since", { withTimezone: true }),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
}, (t) => [...tenant(t, "event_people"), uniqueIndex("event_people_once").on(t.eventId, t.personKey), index("event_people_user").on(t.schoolId, t.userId)]);

export const eventFiles = pgTable("event_files", {
  ...schoolColumns(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  fileKey: text("file_key").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
}, (t) => [...tenant(t, "event_files"), index("event_files_event").on(t.eventId)]);

/** A person's secret calendar link. Only the hash is stored; making a new one ends the old one. */
export const calendarFeeds = pgTable("calendar_feeds", {
  ...schoolColumns(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, (t) => [...tenant(t, "calendar_feeds"), uniqueIndex("calendar_feeds_user").on(t.schoolId, t.userId), uniqueIndex("calendar_feeds_token").on(t.tokenHash), index("calendar_feeds_used").on(t.schoolId, sql`${t.lastUsedAt}`)]);
