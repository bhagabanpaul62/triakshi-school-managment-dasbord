import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";

export const THREAD_KINDS = ["direct", "group"] as const;

export const messageThreads = pgTable("message_threads", {
  ...schoolColumns(),
  subject: text("subject").notNull(),
  kind: text("kind").$type<(typeof THREAD_KINDS)[number]>().notNull().default("direct"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [...tenant(t, "message_threads"), index("message_threads_last").on(t.schoolId, t.lastMessageAt)]);

/** Who is in a conversation. Every query for threads and messages goes through this table. */
export const threadMembers = pgTable("thread_members", {
  ...schoolColumns(),
  threadId: uuid("thread_id").notNull().references(() => messageThreads.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Null until the member opens the conversation. Messages after this (from others) are unread. */
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
}, (t) => [...tenant(t, "thread_members"), uniqueIndex("thread_members_unique").on(t.threadId, t.userId), index("thread_members_user").on(t.userId)]);

export const messages = pgTable("messages", {
  ...schoolColumns(),
  threadId: uuid("thread_id").notNull().references(() => messageThreads.id, { onDelete: "cascade" }),
  /** Null when the sender's account was removed. */
  senderId: uuid("sender_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
}, (t) => [...tenant(t, "messages"), index("messages_thread").on(t.threadId, t.createdAt)]);
