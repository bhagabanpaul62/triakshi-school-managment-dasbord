import { sql } from "drizzle-orm";
import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";
import { students } from "@smw/feature-students/schema";
import type { MemberState, ReportState, RestrictionKind, ThreadKind, ThreadState } from "./constants";

/** One message to many families makes one private conversation per family, tied together here. */
export const messageBatches = pgTable("message_batches", {
  ...schoolColumns(),
  subject: text("subject").notNull(),
  audienceLabel: text("audience_label").notNull(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [...tenant(t, "message_batches"), index("message_batches_creator").on(t.schoolId, t.createdBy)]);

export const messageThreads = pgTable("message_threads", {
  ...schoolColumns(),
  /** student: staff and one family, about that child. staff: staff only. request: owned by the requests module. legacy: an old mixed group, read only. */
  kind: text("kind").$type<ThreadKind>().notNull(),
  subject: text("subject").notNull(),
  /** Always set for `student`; never two families in one conversation (checked in the service and by sql/10-safety.sql). */
  studentId: uuid("student_id").references(() => students.id, { onDelete: "set null" }),
  batchId: uuid("batch_id").references(() => messageBatches.id, { onDelete: "set null" }),
  state: text("state").$type<ThreadState>().notNull().default("open"),
  closedReason: text("closed_reason"),
  /** Set by a report: nothing in it can be removed and it does not expire. */
  heldAt: timestamp("held_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [...tenant(t, "message_threads"), index("message_threads_last").on(t.schoolId, t.lastMessageAt), index("message_threads_student").on(t.schoolId, t.studentId), index("message_threads_batch").on(t.batchId)]);

/** Who is in a conversation. Every query for threads and messages goes through this table. */
export const threadMembers = pgTable("thread_members", {
  ...schoolColumns(),
  threadId: uuid("thread_id").notNull().references(() => messageThreads.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  /** Kept when the login is removed. */
  name: text("name").notNull(),
  role: text("role").notNull(),
  state: text("state").$type<MemberState>().notNull().default("active"),
  muted: boolean("muted").notNull().default(false),
  archived: boolean("archived").notNull().default(false),
  pinned: boolean("pinned").notNull().default(false),
  /** Null until the member opens the conversation. Messages after this (from others) are unread. */
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
}, (t) => [...tenant(t, "thread_members"), uniqueIndex("thread_members_unique").on(t.threadId, t.userId), index("thread_members_user").on(t.schoolId, t.userId)]);

export const messages = pgTable("messages", {
  ...schoolColumns(),
  threadId: uuid("thread_id").notNull().references(() => messageThreads.id, { onDelete: "cascade" }),
  /** Null when the sender's account was removed, or for a system line. */
  senderId: uuid("sender_id").references(() => users.id, { onDelete: "set null" }),
  senderName: text("sender_name").notNull(),
  kind: text("kind").$type<"text" | "system">().notNull().default("text"),
  body: text("body").notNull(),
  /** Made by the browser, so a double press or a retry stores one message. */
  clientId: text("client_id"),
  /** Staff-only note inside a request. Never sent to the family. */
  internal: boolean("internal").notNull().default(false),
  /** Shown to the family as "School office (name)". */
  asOffice: boolean("as_office").notNull().default(false),
  /** Quiet hours: push and email wait until then. The app shows it at once. */
  deliverAfter: timestamp("deliver_after", { withTimezone: true }),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  removedBy: uuid("removed_by"),
}, (t) => [...tenant(t, "messages"), index("messages_thread").on(t.threadId, t.createdAt), index("messages_sender").on(t.schoolId, t.senderId, t.createdAt), uniqueIndex("messages_client").on(t.schoolId, t.senderId, t.clientId)]);

export const messageFiles = pgTable("message_files", {
  ...schoolColumns(),
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  fileKey: text("file_key").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
}, (t) => [...tenant(t, "message_files"), index("message_files_message").on(t.messageId)]);

export const messageReports = pgTable("message_reports", {
  ...schoolColumns(),
  threadId: uuid("thread_id").notNull().references(() => messageThreads.id, { onDelete: "restrict" }),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "restrict" }),
  category: text("category").notNull(),
  note: text("note").notNull(),
  reportedBy: uuid("reported_by"),
  reporterName: text("reporter_name").notNull(),
  /** People the report is about: they never see it. */
  aboutUserIds: uuid("about_user_ids").array().notNull().default(sql`'{}'::uuid[]`),
  state: text("state").$type<ReportState>().notNull().default("new"),
  outcome: text("outcome"),
  handledBy: uuid("handled_by"),
  handledAt: timestamp("handled_at", { withTimezone: true }),
}, (t) => [...tenant(t, "message_reports"), index("message_reports_state").on(t.schoolId, t.state)]);

/** Every time somebody opened a conversation they are not in, and why. Append only. */
export const messageReviews = pgTable("message_reviews", {
  ...schoolColumns(),
  threadId: uuid("thread_id").notNull().references(() => messageThreads.id, { onDelete: "restrict" }),
  reportId: uuid("report_id"),
  reviewerId: uuid("reviewer_id").notNull(),
  reviewerName: text("reviewer_name").notNull(),
  reason: text("reason").notNull(),
  action: text("action").$type<"opened" | "exported">().notNull().default("opened"),
}, (t) => [...tenant(t, "message_reviews"), index("message_reviews_time").on(t.schoolId, t.createdAt)]);

export const messageRestrictions = pgTable("message_restrictions", {
  ...schoolColumns(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").$type<RestrictionKind>().notNull(),
  reason: text("reason").notNull(),
  until: date("until").notNull(),
  liftedAt: timestamp("lifted_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
}, (t) => [...tenant(t, "message_restrictions"), index("message_restrictions_user").on(t.schoolId, t.userId)]);

export const savedReplies = pgTable("saved_replies", {
  ...schoolColumns(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  /** Null = shared by the office. */
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
}, (t) => [...tenant(t, "saved_replies"), index("saved_replies_user").on(t.schoolId, t.userId)]);
