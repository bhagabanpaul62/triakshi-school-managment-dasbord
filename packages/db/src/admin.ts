// Schema push, post-migrate SQL and per-test databases. Dev and test tooling only: never imported by apps.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";

const REPO = resolve(import.meta.dirname, "../../..");

/** Schema modules to push: platform tables plus the given features (all when omitted). */
export function schemaFiles(features?: string[]) {
  const files = readdirSync(join(REPO, "packages/db/src/schema")).filter((f) => f.endsWith(".ts")).map((f) => join(REPO, "packages/db/src/schema", f));
  const featureDir = join(REPO, "features");
  for (const name of readdirSync(featureDir)) {
    if (features && !features.includes(name)) continue;
    const f = join(featureDir, name, "schema.ts");
    if (existsSync(f)) files.push(f);
  }
  return files;
}

function postSqlFiles(features?: string[]) {
  const dirs = [join(REPO, "packages/db/sql")];
  for (const name of readdirSync(join(REPO, "features"))) {
    if (features && !features.includes(name)) continue;
    dirs.push(join(REPO, "features", name, "sql"));
  }
  return dirs.filter(existsSync).flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".sql")).sort().map((f) => join(d, f)));
}

/** CREATE statements for platform tables + the given features, from an empty schema (drizzle-kit generate, which keeps RLS policies intact). */
export async function schemaStatements(features?: string[]) {
  const { generateDrizzleJson, generateMigration } = await import("drizzle-kit/api");
  const imports: Record<string, unknown> = {};
  for (const f of schemaFiles(features)) Object.assign(imports, await import(pathToFileURL(f).href));
  return generateMigration(generateDrizzleJson({}), generateDrizzleJson(imports));
}

/**
 * Drop and rebuild the public schema, then apply the post SQL. Local and test databases only:
 * refuses anything that is not on localhost.
 */
export async function resetDatabase(url: string, features?: string[]) {
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost", "postgres"].includes(host)) throw new Error(`resetDatabase refuses non-local host ${host}`);
  const statements = await schemaStatements(features);
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await client.unsafe("drop schema if exists public cascade; create schema public; grant usage on schema public to app_school, app_console;");
    for (const st of statements) await client.unsafe(st);
    for (const f of postSqlFiles(features)) await client.unsafe(readFileSync(f, "utf8"));
  } finally {
    await client.end();
  }
  return statements.length;
}

/** Apply only the post SQL (after `drizzle-kit migrate` in production). */
export async function applyPostSql(url: string, features?: string[]) {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    for (const f of postSqlFiles(features)) await client.unsafe(readFileSync(f, "utf8"));
  } finally {
    await client.end();
  }
}

const withDb = (url: string, db: string) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };

/**
 * A fresh database for one test suite, named after it, with platform tables + the given features.
 * Sets DATABASE_URL_* in process.env so `env()` in the test workers points at it.
 */
export async function setupTestDatabase(name: string, features: string[]) {
  const { env } = await import("@smw/config");
  const e = env();
  const dbName = `smw_t_${name.replace(/[^a-z0-9_]/gi, "_").toLowerCase()}`;
  const admin = postgres(e.DATABASE_URL_MIGRATE, { max: 1, onnotice: () => {} });
  await admin.unsafe(`drop database if exists ${dbName} with (force)`);
  await admin.unsafe(`create database ${dbName}`);
  await admin.end();
  const migrateUrl = withDb(e.DATABASE_URL_MIGRATE, dbName);
  await resetDatabase(migrateUrl, features);
  process.env.DATABASE_URL_MIGRATE = migrateUrl;
  process.env.DATABASE_URL_SCHOOL = withDb(e.DATABASE_URL_SCHOOL, dbName);
  process.env.DATABASE_URL_CONSOLE = withDb(e.DATABASE_URL_CONSOLE, dbName);
  return dbName;
}
