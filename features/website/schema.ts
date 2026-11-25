import { bigint, boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { schoolColumns, tenant } from "@smw/db";
import type { DisclosureData, SiteContent, SiteSettings, TemplateKey } from "@smw/site-templates";

export const ENQUIRY_STATUSES = ["new", "contacted", "visit", "visited", "applied", "offered", "waitlist", "admitted", "closed"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];
export const ENQUIRY_KINDS = ["admission", "question"] as const;
export const TASK_KINDS = ["call", "visit", "test", "document", "other"] as const;
export const EVENT_KINDS = ["created", "again", "call", "note", "whatsapp", "email", "visit", "stage", "owner", "task", "merged", "admitted", "imported", "edited"] as const;

/** One row per school: the draft being edited and the published copy visitors see. */
export const schoolSites = pgTable("school_sites", {
  ...schoolColumns(),
  templateKey: text("template_key").$type<TemplateKey>().notNull().default("classic"),
  draft: jsonb("draft").$type<SiteContent>().notNull(),
  draftAt: timestamp("draft_at", { withTimezone: true }),
  draftBy: uuid("draft_by"),
  published: jsonb("published").$type<SiteContent>(),
  /** Template that was live at publish time (the draft template can change afterwards). */
  publishedTemplateKey: text("published_template_key").$type<TemplateKey>(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: uuid("published_by"),
  /** A frozen copy waiting for its time. */
  scheduled: jsonb("scheduled").$type<SiteContent>(),
  scheduledTemplateKey: text("scheduled_template_key").$type<TemplateKey>(),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  scheduledBy: uuid("scheduled_by"),
  /** Someone without the publish right asked for it. */
  askedAt: timestamp("asked_at", { withTimezone: true }),
  askedBy: uuid("asked_by"),
  askedNote: text("asked_note"),
  offlineAt: timestamp("offline_at", { withTimezone: true }),
  settings: jsonb("settings").$type<SiteSettings>().notNull().default({} as SiteSettings),
}, (t) => [...tenant(t, "school_sites"), uniqueIndex("school_sites_school").on(t.schoolId)]);

/** Every published copy, and the draft that was there before a restore. Never edited, only named. */
export const siteVersions = pgTable("site_versions", {
  ...schoolColumns(),
  number: integer("number").notNull(),
  kind: text("kind").$type<"publish" | "schedule" | "before_restore">().notNull(),
  templateKey: text("template_key").$type<TemplateKey>().notNull(),
  content: jsonb("content").$type<SiteContent>().notNull(),
  name: text("name"),
  changes: text("changes").array().notNull().default(sql`'{}'::text[]`),
  byUserId: uuid("by_user_id"),
  byName: text("by_name"),
}, (t) => [...tenant(t, "site_versions"), uniqueIndex("site_versions_number").on(t.schoolId, t.number)]);

/** Photos and documents of the website. The file lives under `<school>/public/site/`. */
export const siteMedia = pgTable("site_media", {
  ...schoolColumns(),
  kind: text("kind").$type<"photo" | "document">().notNull(),
  fileKey: text("file_key").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  alt: text("alt"),
  /** A photo replaced in place keeps its address and gets a new stored file. */
  replacedKey: text("replaced_key"),
  uploadedBy: uuid("uploaded_by"),
}, (t) => [...tenant(t, "site_media"), uniqueIndex("site_media_key").on(t.schoolId, t.fileKey)]);

/** "/old-page" → "/new-page" or a full https link. */
export const siteRedirects = pgTable("site_redirects", {
  ...schoolColumns(),
  fromPath: text("from_path").notNull(),
  toPath: text("to_path").notNull(),
  /** Made by renaming a page (not typed by a person). */
  automatic: boolean("automatic").notNull().default(false),
}, (t) => [...tenant(t, "site_redirects"), uniqueIndex("site_redirects_from").on(t.schoolId, t.fromPath)]);

/** Views per page, day and kind of origin. No person, no cookie, no address is stored. */
export const sitePageDays = pgTable("site_page_days", {
  ...schoolColumns(),
  day: date("day", { mode: "string" }).notNull(),
  path: text("path").notNull(),
  origin: text("origin").$type<"direct" | "search" | "social" | "other">().notNull(),
  views: bigint("views", { mode: "number" }).notNull().default(0),
}, (t) => [...tenant(t, "site_page_days"), uniqueIndex("site_page_days_key").on(t.schoolId, t.day, t.path, t.origin)]);

/** The mandatory disclosure being edited; the published page carries its own frozen copy. */
export const siteDisclosure = pgTable("site_disclosure", {
  ...schoolColumns(),
  data: jsonb("data").$type<DisclosureData>().notNull(),
  updatedBy: uuid("updated_by"),
  /** Documents already warned about: key → date of the warning. */
  warned: jsonb("warned").$type<Record<string, string>>().notNull().default({}),
}, (t) => [...tenant(t, "site_disclosure"), uniqueIndex("site_disclosure_school").on(t.schoolId)]);

/** Admission enquiries from the public website (or added by staff), and general questions from the contact form. */
export const enquiries = pgTable("enquiries", {
  ...schoolColumns(),
  /** "E-2026-0042", gap-free per calendar year. */
  ref: text("ref"),
  kind: text("kind").$type<(typeof ENQUIRY_KINDS)[number]>().notNull().default("admission"),
  studentName: text("student_name").notNull(),
  dob: date("dob", { mode: "string" }),
  gender: text("gender"),
  classApplying: text("class_applying"),
  /** "2026-27". */
  session: text("session"),
  previousSchool: text("previous_school"),
  parentName: text("parent_name").notNull(),
  relation: text("relation"),
  phone: text("phone").notNull(),
  /** Last 10 digits: how duplicates are found. */
  phoneKey: text("phone_key").notNull().default(""),
  altPhone: text("alt_phone"),
  email: text("email"),
  address: text("address"),
  message: text("message"),
  source: text("source").notNull().default("website"),
  campaign: text("campaign"),
  /** The page of the website the form was sent from ("/admissions"), for the insights per page. */
  pagePath: text("page_path"),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  consentText: text("consent_text"),
  status: text("status").$type<EnquiryStatus>().notNull().default("new"),
  stageAt: timestamp("stage_at", { withTimezone: true }).notNull().defaultNow(),
  /** The furthest stage ever reached, so the funnel survives a move back or a close. */
  reached: text("reached").$type<EnquiryStatus>().notNull().default("new"),
  closeReason: text("close_reason"),
  ownerId: uuid("owner_id"),
  priority: boolean("priority").notNull().default(false),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  firstContactAt: timestamp("first_contact_at", { withTimezone: true }),
  /** Earliest open task; kept by the service so lists can sort on it. */
  nextAt: timestamp("next_at", { withTimezone: true }),
  callDueAt: timestamp("call_due_at", { withTimezone: true }),
  lateToldAt: timestamp("late_told_at", { withTimezone: true }),
  notes: text("notes"),
  /** Soft reference to students.id once the child is admitted (the website feature does not require students). */
  convertedStudentId: uuid("converted_student_id"),
  mergedInto: uuid("merged_into"),
}, (t) => [
  ...tenant(t, "enquiries"),
  index("enquiries_school_status").on(t.schoolId, t.status, t.createdAt),
  index("enquiries_next").on(t.schoolId, t.nextAt),
  index("enquiries_phone").on(t.schoolId, t.phoneKey),
  uniqueIndex("enquiries_ref").on(t.schoolId, t.ref),
]);

/** The timeline of an enquiry. Append-only. */
export const enquiryEvents = pgTable("enquiry_events", {
  ...schoolColumns(),
  enquiryId: uuid("enquiry_id").notNull().references(() => enquiries.id, { onDelete: "cascade" }),
  kind: text("kind").$type<(typeof EVENT_KINDS)[number]>().notNull(),
  body: text("body"),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  byUserId: uuid("by_user_id"),
  byName: text("by_name").notNull(),
}, (t) => [...tenant(t, "enquiry_events"), index("enquiry_events_enquiry").on(t.enquiryId, t.createdAt)]);

/** Next steps. An open enquiry should have one. */
export const enquiryTasks = pgTable("enquiry_tasks", {
  ...schoolColumns(),
  enquiryId: uuid("enquiry_id").notNull().references(() => enquiries.id, { onDelete: "cascade" }),
  kind: text("kind").$type<(typeof TASK_KINDS)[number]>().notNull(),
  title: text("title"),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  ownerId: uuid("owner_id"),
  doneAt: timestamp("done_at", { withTimezone: true }),
  outcome: text("outcome"),
  remindedAt: timestamp("reminded_at", { withTimezone: true }),
}, (t) => [...tenant(t, "enquiry_tasks"), index("enquiry_tasks_enquiry").on(t.enquiryId), index("enquiry_tasks_due").on(t.schoolId, t.dueAt).where(sql`${t.doneAt} is null`)]);

/** Sources, close reasons, templates, owner rule, targets, keeping time: one row per school, read through a zod schema with defaults. */
export const enquirySettings = pgTable("enquiry_settings", {
  ...schoolColumns(),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [...tenant(t, "enquiry_settings"), uniqueIndex("enquiry_settings_school").on(t.schoolId)]);

/** Seats on offer per class and session. */
export const enquirySeats = pgTable("enquiry_seats", {
  ...schoolColumns(),
  session: text("session").notNull(),
  className: text("class_name").notNull(),
  seats: integer("seats").notNull(),
}, (t) => [...tenant(t, "enquiry_seats"), uniqueIndex("enquiry_seats_key").on(t.schoolId, t.session, t.className)]);
