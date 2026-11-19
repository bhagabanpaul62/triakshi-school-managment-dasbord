/**
 * Database access: Drizzle client, platform tables, RLS helpers and `withSchool()`.
 * @module @smw/db
 */
export * from "./client";
export * from "./columns";
export * from "./uuid";
export * from "./schema/platform";
export * from "./sequence";
export { sql, and, or, eq, ne, gt, gte, lt, lte, isNull, isNotNull, inArray, notInArray, desc, asc, ilike, count, sum, exists, between } from "drizzle-orm";
