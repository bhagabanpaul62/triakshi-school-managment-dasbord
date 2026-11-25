import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant, users } from "@smw/db";
import type { Audience } from "@smw/feature-notifications/audience-rules";
import type { Answer, NoticeState, NoticeType, ResponseSpec } from "./constants";

export const announcementCategories = pgTable("announcement_categories", {
  ...schoolColumns(),
  name: text("name").notNull(),
  tone: text("tone").$type<"default" | "info" | "success" | "warning">().notNull().default("default"),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
}, (t) => [...tenant(t, "announcement_categories"), uniqueIndex("announcement_categories_name").on(t.schoolId, sql`lower(${t.name})`)]);

export const announcements = pgTable("announcements", {
  ...schoolColumns(),
  type: text("type").$type<NoticeType>().notNull().default("notice"),
  /** Circulars only, given at publish and never reused: "CIR/2026-27/014". */
  number: text("number"),
  categoryId: uuid("category_id").references(() => announcementCategories.id, { onDelete: "restrict" }),
  state: text("state").$type<NoticeState>().notNull().default("draft"),
  title: text("title").notNull(),
  /** Safe markdown subset (markdown.ts). Never HTML. */
  body: text("body").notNull(),
  lang2: text("lang2"),
  title2: text("title2"),
  body2: text("body2"),
  audience: jsonb("audience").$type<Audience>().notNull(),
  /** How the audience reads to a person, frozen at publish: "Class 5 A and 2 more". */
  audienceLabel: text("audience_label").notNull().default(""),
  response: jsonb("response").$type<ResponseSpec>().notNull().default({ kind: "none" }),
  dueAt: timestamp("due_at", { withTimezone: true }),
  /** Reminders to people who have not answered: two days before, on the day, the day after. */
  reminders: jsonb("reminders").$type<{ before: boolean; onDay: boolean; after: boolean }>().notNull().default({ before: true, onDay: true, after: true }),
  website: boolean("website").notNull().default(false),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  /** While sending: fan-out starts here; until then it can be undone. */
  sendAt: timestamp("send_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  fannedOutAt: timestamp("fanned_out_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  pinnedUntil: timestamp("pinned_until", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  correctedAt: timestamp("corrected_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvalReason: text("approval_reason"),
  /** What the approver asked to change, or why it was rejected. */
  reviewNote: text("review_note"),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  withdrawnBy: uuid("withdrawn_by"),
  withdrawReason: text("withdraw_reason"),
  /** Random token in the circular's QR link, hashed. */
  verifyHash: text("verify_hash"),
}, (t) => [...tenant(t, "announcements"), index("announcements_school_published").on(t.schoolId, t.publishedAt), index("announcements_state").on(t.schoolId, t.state),
  uniqueIndex("announcements_number").on(t.schoolId, t.number), index("announcements_verify").on(t.verifyHash)]);

/** What a published notice said before each correction. Append only (sql/10-append-only.sql). */
export const announcementVersions = pgTable("announcement_versions", {
  ...schoolColumns(),
  announcementId: uuid("announcement_id").notNull().references(() => announcements.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  note: text("note"),
  changedBy: uuid("changed_by"),
}, (t) => [...tenant(t, "announcement_versions"), uniqueIndex("announcement_versions_unique").on(t.announcementId, t.version)]);

export const announcementFiles = pgTable("announcement_files", {
  ...schoolColumns(),
  announcementId: uuid("announcement_id").notNull().references(() => announcements.id, { onDelete: "cascade" }),
  fileKey: text("file_key").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  sort: integer("sort").notNull().default(0),
}, (t) => [...tenant(t, "announcement_files"), index("announcement_files_notice").on(t.announcementId)]);

/** Who a published notice was for, frozen. Names are kept so the report reads the same for ever. */
export const announcementRecipients = pgTable("announcement_recipients", {
  ...schoolColumns(),
  announcementId: uuid("announcement_id").notNull().references(() => announcements.id, { onDelete: "restrict" }),
  /** personKey(): `s:<studentId>` or `u:<userId>`. */
  personKey: text("person_key").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  studentId: uuid("student_id"),
  name: text("name").notNull(),
  label: text("label").notNull().default(""),
  sectionId: uuid("section_id"),
  joinedLate: boolean("joined_late").notNull().default(false),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  seenAt: timestamp("seen_at", { withTimezone: true }),
  nudgedAt: timestamp("nudged_at", { withTimezone: true }),
  /** Rows made by the move from the old module: seen is unknown for them. */
  beforeTracking: boolean("before_tracking").notNull().default(false),
}, (t) => [...tenant(t, "announcement_recipients"), uniqueIndex("announcement_recipients_once").on(t.announcementId, t.personKey), index("announcement_recipients_user").on(t.schoolId, t.userId)]);

export const announcementResponses = pgTable("announcement_responses", {
  ...schoolColumns(),
  recipientId: uuid("recipient_id").notNull().references(() => announcementRecipients.id, { onDelete: "restrict" }),
  answer: jsonb("answer").$type<Answer>().notNull(),
  /** The login is shared by the family, so the adult who answered says who they are. */
  byName: text("by_name").notNull(),
  byRelation: text("by_relation").notNull(),
  onPaper: boolean("on_paper").notNull().default(false),
  fileKey: text("file_key"),
  recordedBy: uuid("recorded_by"),
  ip: text("ip"),
}, (t) => [...tenant(t, "announcement_responses"), uniqueIndex("announcement_responses_recipient").on(t.recipientId)]);

export const announcementTemplates = pgTable("announcement_templates", {
  ...schoolColumns(),
  name: text("name").notNull(),
  draft: jsonb("draft").$type<Record<string, unknown>>().notNull(),
}, (t) => [...tenant(t, "announcement_templates"), uniqueIndex("announcement_templates_name").on(t.schoolId, t.name)]);
