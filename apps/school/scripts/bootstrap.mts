// Production: sync the module catalogue and create the default plans if missing. Idempotent; run after every migrate.
import { closeDb, withConsole } from "@smw/db";
import { syncCatalog } from "./catalog.mjs";

const ids = await withConsole(syncCatalog);
console.log(`catalogue synced, plans: ${Object.keys(ids).join(", ")}`);
await closeDb();
