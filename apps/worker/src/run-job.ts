// Local tool: run one worker job once. pnpm --filter @smw/worker job comms.publish-due '{"schoolId":"..."}'
import { closeDb } from "@smw/db";
import { FEATURE_JOBS } from "./generated/jobs";

const [name, data] = process.argv.slice(2);
const job = Object.assign({}, ...FEATURE_JOBS)[name ?? ""] as ((d: unknown) => Promise<unknown>) | undefined;
if (!job) { console.error(`no job named ${name}`); process.exit(1); }
await job(data ? JSON.parse(data) : {});
await closeDb();
