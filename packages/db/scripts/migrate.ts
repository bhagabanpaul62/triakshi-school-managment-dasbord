// Production: apply generated migrations in order, then the idempotent post SQL.
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@smw/config";
import { applyPostSql } from "../src/admin";

const url = env().DATABASE_URL_MIGRATE;
const client = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(client), { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
await client.end();
await applyPostSql(url);
console.log("migrations applied");
