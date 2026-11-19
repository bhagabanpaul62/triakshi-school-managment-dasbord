// Local only: rebuild the dev database from the schema files. Run `pnpm db:seed` after it.
import { env } from "@smw/config";
import { resetDatabase } from "../src/admin";
const n = await resetDatabase(env().DATABASE_URL_MIGRATE);
console.log(`dev database rebuilt (${n} statements)`);
