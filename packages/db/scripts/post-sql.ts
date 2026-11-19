// Re-apply grants, triggers and functions (packages/db/sql + features/*/sql) without touching data.
import { env } from "@smw/config";
import { applyPostSql } from "../src/admin";
await applyPostSql(env().DATABASE_URL_MIGRATE);
console.log("post SQL applied");
