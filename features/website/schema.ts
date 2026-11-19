import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, date } from "drizzle-orm/pg-core";
import { schoolColumns, tenant } from "@smw/db";
import type { SiteContent, TemplateKey } from "@smw/site-templates";

export const ENQUIRY_STATUSES = ["new", "contacted", "visited", "admitted", "closed"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

/** One row per school: the draft being edited and the published copy visitors see. */
export const schoolSites = pgTable("school_sites", {
  ...schoolColumns(),
  templateKey: text("template_key").$type<TemplateKey>().notNull().default("classic"),
  draft: jsonb("draft").$type<SiteContent>().notNull(),
  published: jsonb("published").$type<SiteContent>(),
  /** Template that was live at publish time (the draft template can change afterwards). */
  publishedTemplateKey: text("published_template_key").$type<TemplateKey>(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, (t) => [...tenant(t, "school_sites"), uniqueIndex("school_sites_school").on(t.schoolId)]);

/** Admission enquiries from the public website (or added by staff). */
export const enquiries = pgTable("enquiries", {
  ...schoolColumns(),
  studentName: text("student_name").notNull(),
  dob: date("dob", { mode: "string" }),
  classApplying: text("class_applying"),
  parentName: text("parent_name").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  message: text("message"),
  source: text("source").notNull().default("website"),
  status: text("status").$type<EnquiryStatus>().notNull().default("new"),
  notes: text("notes"),
  /** Soft reference to students.id once the child is admitted (the website feature does not require students). */
  convertedStudentId: uuid("converted_student_id"),
}, (t) => [...tenant(t, "enquiries"), index("enquiries_school_status").on(t.schoolId, t.status, t.createdAt)]);
