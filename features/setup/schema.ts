import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant } from "@smw/db";

/** What people decided about a getting-started task. Whether it is done is read from the data, never stored. */
export const setupTasks = pgTable("setup_tasks", {
  ...schoolColumns(),
  key: text("key").notNull(),
  assignedTo: uuid("assigned_to"),
  assignedBy: uuid("assigned_by"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }),
  skippedAt: timestamp("skipped_at", { withTimezone: true }),
  skippedBy: uuid("skipped_by"),
  skipReason: text("skip_reason"),
}, (t) => [...tenant(t, "setup_tasks"), uniqueIndex("setup_tasks_key").on(t.schoolId, t.key)]);

/** The getting-started card is hidden for the school (key "_card"), not per browser: it is a row above with skippedAt. */
export const CARD_KEY = "_card";
