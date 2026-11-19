import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, subscriptions } from "@smw/db";

/**
 * Renewal reminder markers: one row per (subscription, period end, offset), so the daily job never emails twice.
 * Platform-only (no school_id): the school role is revoked in sql/10-grants.sql.
 */
export const billingReminders = pgTable("billing_reminders", {
  id: id(),
  subscriptionId: uuid("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "cascade" }),
  periodKey: text("period_key").notNull(),
  offsetDays: integer("offset_days").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("billing_reminders_once").on(t.subscriptionId, t.periodKey, t.offsetDays)]);
