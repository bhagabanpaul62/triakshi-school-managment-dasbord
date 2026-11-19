import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant } from "@smw/db";

export const ANNOUNCEMENT_AUDIENCES = ["all", "staff", "students", "parents", "class"] as const;

export const announcements = pgTable("announcements", {
  ...schoolColumns(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  audience: text("audience").$type<(typeof ANNOUNCEMENT_AUDIENCES)[number]>().notNull().default("all"),
  /** Set when audience = class. Soft reference to academics.classes (this feature does not require academics). */
  classId: uuid("class_id"),
  isPublic: boolean("is_public").notNull().default(false),
  pinned: boolean("pinned").notNull().default(false),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "announcements"), index("announcements_school_published").on(t.schoolId, t.publishedAt)]);
