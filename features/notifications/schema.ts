import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";
import type { Audience } from "./audience-rules";
import type { Channel, DeliveryState, EmailMode } from "./constants";
import type { TopicGroup, TopicKey } from "./topics";

export const notifications = pgTable("notifications", {
  ...schoolColumns(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** What this is about: decides the group, the channels and whether people may turn it off. */
  topic: text("topic").$type<TopicKey>().notNull().default("work.update"),
  title: text("title").notNull(),
  body: text("body"),
  /** App path to open, e.g. /app/fees. */
  href: text("href"),
  /** The thing it is about. Opening that thing marks this read (NotificationWriter.seen). */
  subjectType: text("subject_type"),
  subjectId: text("subject_id"),
  /** Unread rows with the same key become one row with a count. */
  groupKey: text("group_key"),
  count: integer("count").notNull().default(1),
  /** Something this person must do. Closed by the module (NotificationWriter.done), not by reading. */
  action: boolean("action").notNull().default(false),
  doneAt: timestamp("done_at", { withTimezone: true }),
  urgent: boolean("urgent").notNull().default(false),
  /** The body is private: never shown on a locked phone or sent to an unverified address. */
  privateBody: boolean("private_body").notNull().default(false),
  readAt: timestamp("read_at", { withTimezone: true }),
}, (t) => [...tenant(t, "notifications"),
  index("notifications_user_created").on(t.schoolId, t.userId, t.createdAt),
  index("notifications_subject").on(t.schoolId, t.subjectType, t.subjectId),
  index("notifications_open_action").on(t.schoolId, t.userId).where(sql`${t.action} and ${t.doneAt} is null`),
  uniqueIndex("notifications_group_open").on(t.schoolId, t.userId, t.groupKey).where(sql`${t.groupKey} is not null and ${t.readAt} is null and ${t.doneAt} is null`)]);

export interface GroupPref { push: boolean; email: EmailMode }

export const notificationPrefs = pgTable("notification_prefs", {
  ...schoolColumns(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Only what the person changed; everything else follows the school, then the topic. */
  groups: jsonb("groups").$type<Partial<Record<TopicGroup, GroupPref>>>().notNull().default({}),
  digestHour: smallint("digest_hour").$type<8 | 18>().notNull().default(18),
  /** "HH:MM" IST. Null = the school's quiet hours. */
  quietFrom: text("quiet_from"),
  quietTo: text("quiet_to"),
  awayUntil: date("away_until"),
  awayText: text("away_text"),
  language: text("language"),
  /** Hash of the token in unsubscribe links. */
  unsubscribeHash: text("unsubscribe_hash"),
}, (t) => [...tenant(t, "notification_prefs"), uniqueIndex("notification_prefs_user").on(t.schoolId, t.userId), index("notification_prefs_unsub").on(t.unsubscribeHash)]);

/** One row per thing, person and channel: what was sent, what failed and why. The worker drains it by priority, budget and quiet hours. */
export const commDeliveries = pgTable("comm_deliveries", {
  ...schoolColumns(),
  /** "notification:<id>" or a module's own key; with user and channel it is unique, so a rerun never sends twice. */
  sourceKey: text("source_key").notNull(),
  notificationId: uuid("notification_id").references(() => notifications.id, { onDelete: "set null" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  channel: text("channel").$type<Channel>().notNull(),
  mode: text("mode").$type<"instant" | "digest">().notNull().default("instant"),
  /** 1 urgent, 2 safety, 3 needs an answer, 4 the rest. Account codes are sent directly and never wait here. */
  priority: smallint("priority").notNull().default(4),
  state: text("state").$type<DeliveryState>().notNull().default("pending"),
  /** Why it was skipped, deferred or failed, in plain words. */
  reason: text("reason"),
  /** The address used, kept for the report. */
  address: text("address"),
  tries: integer("tries").notNull().default(0),
  nextAt: timestamp("next_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, (t) => [...tenant(t, "comm_deliveries"),
  uniqueIndex("comm_deliveries_once").on(t.schoolId, t.sourceKey, t.userId, t.channel),
  index("comm_deliveries_due").on(t.state, t.nextAt, t.priority),
  index("comm_deliveries_notification").on(t.notificationId)]);

export const pushSubscriptions = pgTable("push_subscriptions", {
  ...schoolColumns(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  device: text("device"),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
}, (t) => [...tenant(t, "push_subscriptions"), uniqueIndex("push_subscriptions_endpoint").on(t.endpoint), index("push_subscriptions_user").on(t.schoolId, t.userId)]);

export const emailSuppressions = pgTable("email_suppressions", {
  ...schoolColumns(),
  address: text("address").notNull(),
  reason: text("reason").$type<"bounced" | "spam" | "invalid">().notNull(),
}, (t) => [...tenant(t, "email_suppressions"), uniqueIndex("email_suppressions_address").on(t.schoolId, sql`lower(${t.address})`)]);

/** Emails sent per school and IST day, so the daily limit is shared fairly and codes always have room. */
export const mailUsage = pgTable("mail_usage", {
  ...schoolColumns(),
  day: date("day").notNull(),
  count: integer("count").notNull().default(0),
}, (t) => [...tenant(t, "mail_usage"), uniqueIndex("mail_usage_day").on(t.schoolId, t.day)]);

/** One row per school. Read through loadCommSettings (settings.ts), which fills the defaults. */
export const commSettings = pgTable("comm_settings", {
  ...schoolColumns(),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [...tenant(t, "comm_settings"), uniqueIndex("comm_settings_school").on(t.schoolId)]);

/** A saved audience. */
export const commGroups = pgTable("comm_groups", {
  ...schoolColumns(),
  name: text("name").notNull(),
  audience: jsonb("audience").$type<Audience>().notNull(),
  shared: boolean("shared").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [...tenant(t, "comm_groups"), uniqueIndex("comm_groups_name").on(t.schoolId, t.name)]);

export type Notification = typeof notifications.$inferSelect;
export type Delivery = typeof commDeliveries.$inferSelect;
