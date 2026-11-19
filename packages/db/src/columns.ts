// Column helpers shared by every table, so each schema file states only what is special about it.
import { sql, type SQL } from "drizzle-orm";
import { index, pgPolicy, timestamp, uuid, type PgColumn } from "drizzle-orm/pg-core";
import { uuidv7 } from "./uuid";

/** UUIDv7 primary key: sorts by time, leaks no counts. */
export const id = () => uuid("id").primaryKey().$defaultFn(uuidv7);

/** The tenant column every school-owned table carries. */
export const schoolId = () => uuid("school_id").notNull();

export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());

/** id + school_id + created_at + updated_at: spread into every school-owned table. */
export const schoolColumns = () => ({ id: id(), schoolId: schoolId(), createdAt: createdAt(), updatedAt: updatedAt() });

/** The setting `withSchool()` writes; NULL (no rows) when unset. */
export const CURRENT_SCHOOL: SQL = sql`nullif(current_setting('app.school_id', true), '')::uuid`;

// Plain column name on purpose: drizzle-kit drops column references inside policy SQL.
export const SAME_SCHOOL: SQL = sql.raw("school_id = nullif(current_setting('app.school_id', true), '')::uuid");

/**
 * The two things every school-owned table needs: an index starting with school_id and the RLS policy.
 * Use as the table's extra-config callback, adding your own indexes:
 *   (t) => [...tenant(t, "students"), uniqueIndex(...).on(t.schoolId, t.admissionNo)]
 */
export function tenant(t: { schoolId: PgColumn }, table: string) {
  return [
    index(`${table}_school_idx`).on(t.schoolId),
    pgPolicy(`${table}_school_isolation`, {
      as: "permissive",
      for: "all",
      using: SAME_SCHOOL,
      withCheck: SAME_SCHOOL,
    }),
  ];
}
