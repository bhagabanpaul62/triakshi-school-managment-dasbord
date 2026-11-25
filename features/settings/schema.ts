import { date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant } from "@smw/db";
import { PRIVACY_KINDS, PRIVACY_STATES } from "./privacy-kinds";

export { PRIVACY_KINDS, PRIVACY_STATES };

export const EXPORT_SCOPES = ["school", "student", "person"] as const;
export const EXPORT_STATUSES = ["queued", "running", "ready", "failed", "expired"] as const;

/** One row per data export (DPDP): who asked, what it covers, and where the file is. The file itself lives in storage under `<school>/exports/`. */
export const dataExports = pgTable("data_exports", {
  ...schoolColumns(),
  scope: text("scope").$type<(typeof EXPORT_SCOPES)[number]>().notNull(),
  /** "All school data" or "Student: Riya Sharma". */
  label: text("label").notNull(),
  requestedBy: uuid("requested_by"),
  status: text("status").$type<(typeof EXPORT_STATUSES)[number]>().notNull().default("ready"),
  fileKey: text("file_key"),
  sizeBytes: integer("size_bytes"),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  options: jsonb("options").$type<{ studentId?: string; userId?: string; modules?: string[]; includePayroll?: boolean; includePrivate?: boolean; includeFiles?: boolean; reason?: string; safeguard?: boolean; retried?: boolean; claim?: string; tables?: { table: string; module: string; rows: number }[] }>().notNull().default({}),
  tablesDone: integer("tables_done").notNull().default(0),
  tablesTotal: integer("tables_total").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  downloads: integer("downloads").notNull().default(0),
}, (t) => [...tenant(t, "data_exports"), index("data_exports_school_time").on(t.schoolId, t.createdAt)]);


/** Requests about personal data (DPDP), raised by a person from My profile or written down by the office. */
export const privacyRequests = pgTable("privacy_requests", {
  ...schoolColumns(),
  /** "P-2026-0007", gap-free per calendar year. */
  ref: text("ref").notNull(),
  kind: text("kind").$type<(typeof PRIVACY_KINDS)[number]>().notNull(),
  state: text("state").$type<(typeof PRIVACY_STATES)[number]>().notNull().default("open"),
  /** Who it is about. */
  subjectType: text("subject_type").$type<"student" | "staff" | "enquiry" | "other">().notNull(),
  subjectId: uuid("subject_id"),
  subjectName: text("subject_name").notNull(),
  raisedBy: uuid("raised_by"),
  raisedByName: text("raised_by_name").notNull(),
  contact: text("contact"),
  details: text("details").notNull(),
  dueOn: date("due_on", { mode: "string" }).notNull(),
  ownerId: uuid("owner_id"),
  outcome: text("outcome"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedBy: uuid("closed_by"),
  remindedOn: date("reminded_on", { mode: "string" }),
  steps: jsonb("steps").$type<{ at: string; by: string; text: string }[]>().notNull().default([]),
}, (t) => [...tenant(t, "privacy_requests"), index("privacy_requests_state").on(t.schoolId, t.state, t.dueOn)]);

/** Days to answer a privacy request: one row per school, defaults in code. */
export const accountSettings = pgTable("account_settings", {
  ...schoolColumns(),
  settings: jsonb("settings").$type<{ privacyDays?: number }>().notNull().default({}),
}, (t) => [...tenant(t, "account_settings"), uniqueIndex("account_settings_school").on(t.schoolId)]);

/** Documents on a privacy request (an ID proof, a signed letter). Private: stored under `<school>/private/privacy/<request>/` and handed over only by the checked route. */
export const privacyFiles = pgTable("privacy_files", {
  ...schoolColumns(),
  requestId: uuid("request_id").notNull().references(() => privacyRequests.id, { onDelete: "cascade" }),
  fileKey: text("file_key").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  uploadedBy: uuid("uploaded_by").notNull(),
}, (t) => [...tenant(t, "privacy_files"), index("privacy_files_request").on(t.schoolId, t.requestId)]);
