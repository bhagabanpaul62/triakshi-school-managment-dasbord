import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { schoolColumns, tenant } from "@smw/db";

export const EXPORT_SCOPES = ["school", "student"] as const;
export const EXPORT_STATUSES = ["ready", "failed"] as const;

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
}, (t) => [...tenant(t, "data_exports"), index("data_exports_school_time").on(t.schoolId, t.createdAt)]);
