// Moves each school's old fee tables into invoices and receipts. Safe to run again: a moved school is skipped.
// `pnpm --filter @smw/school move-fees [--dry-run]`. Never changes or deletes the old tables.
import { closeDb } from "@smw/db";
import { moveFees } from "./move-fees-lib.js";

await moveFees({ dryRun: process.argv.includes("--dry-run") }).finally(closeDb);
