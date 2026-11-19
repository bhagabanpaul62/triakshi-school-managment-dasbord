import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";

export const NOTIFICATION_KINDS = ["announcement", "fee_due", "result", "assignment", "message", "system"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export const notifications = pgTable("notifications", {
  ...schoolColumns(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").$type<NotificationKind>().notNull().default("system"),
  title: text("title").notNull(),
  body: text("body"),
  /** App path to open, e.g. /app/fees. */
  href: text("href"),
  readAt: timestamp("read_at", { withTimezone: true }),
  /** Set when the daily email digest has taken this notification; a notification is emailed at most once. */
  digestSentAt: timestamp("digest_sent_at", { withTimezone: true }),
}, (t) => [...tenant(t, "notifications"), index("notifications_user_created").on(t.schoolId, t.userId, t.createdAt)]);

export const notificationPrefs = pgTable("notification_prefs", {
  ...schoolColumns(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  emailDigest: boolean("email_digest").notNull().default(true),
}, (t) => [...tenant(t, "notification_prefs"), uniqueIndex("notification_prefs_user").on(t.schoolId, t.userId)]);

export type Notification = typeof notifications.$inferSelect;
