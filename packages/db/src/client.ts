import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@smw/config";

export type Db = PostgresJsDatabase;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Role = "school" | "console" | "migrate";

// One pool per role per process; kept on globalThis so Next.js dev reloads do not leak connections.
const g = globalThis as unknown as { __smwDb?: Partial<Record<Role, { db: Db; client: postgres.Sql }>> };
g.__smwDb ??= {};

const urlFor = (role: Role) =>
  role === "school" ? env().DATABASE_URL_SCHOOL : role === "console" ? env().DATABASE_URL_CONSOLE : env().DATABASE_URL_MIGRATE;

function pool(role: Role) {
  const cached = g.__smwDb![role];
  if (cached) return cached;
  const client = postgres(urlFor(role), { max: role === "migrate" ? 2 : 10, onnotice: () => {} });
  const entry = { db: drizzle(client), client };
  g.__smwDb![role] = entry;
  return entry;
}

/** Raw pools. School code never uses these directly: use `withSchool`. */
export const schoolDb = () => pool("school").db;
export const consoleDb = () => pool("console").db;
export const migrateDb = () => pool("migrate").db;

/**
 * The only door to school data. Opens a transaction on the RLS-enforced role and pins `app.school_id`,
 * so a query that forgets its WHERE clause still sees only this school.
 */
export async function withSchool<T>(schoolId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(schoolId)) throw new Error("withSchool: invalid school id");
  return schoolDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.school_id', ${schoolId}, true)`);
    return fn(tx);
  });
}

/** Cross-school access for the console and platform jobs (role bypasses RLS). */
export async function withConsole<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return consoleDb().transaction(fn);
}

export async function closeDb() {
  await Promise.all(Object.values(g.__smwDb!).map((e) => e?.client.end({ timeout: 5 })));
  g.__smwDb = {};
}
