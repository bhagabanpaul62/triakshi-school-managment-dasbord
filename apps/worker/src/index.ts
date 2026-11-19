/**
 * Background jobs with pg-boss. Every job is idempotent and safe to retry.
 * pg-boss keeps its tables in the "pgboss" schema and creates them on start, so it connects as the
 * migrate role (DATABASE_URL_MIGRATE), the only role allowed to create objects. Job handlers use their own pools.
 * @module @smw/worker
 */
import { PgBoss } from "pg-boss";
import pino from "pino";
import { env } from "@smw/config";
import { closeDb } from "@smw/db";
import { FEATURE_JOBS } from "./generated/jobs";
import { platformJobs } from "./platform-jobs";
import { SCHEDULES, mergeJobs, scheduledNames, withLogging, type JobMap } from "./registry";

export async function main() {
  const log = pino({ level: env().LOG_LEVEL, base: { app: "worker" } });
  const jobs = mergeJobs(platformJobs(log), ...(FEATURE_JOBS as JobMap[]));

  const boss = new PgBoss({ connectionString: env().DATABASE_URL_MIGRATE, schema: "pgboss" });
  boss.on("error", (err) => log.error({ err }, "pg-boss error"));
  await boss.start();

  for (const [name, fn] of Object.entries(jobs)) {
    await boss.createQueue(name);
    await boss.work(name, { batchSize: 1 }, withLogging(name, fn, log));
  }
  for (const name of scheduledNames(jobs)) {
    const s = SCHEDULES[name]!;
    await boss.schedule(name, s.cron, {}, { tz: s.tz });
  }
  log.info({ jobs: Object.keys(jobs), scheduled: scheduledNames(jobs) }, "worker started");

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "shutting down");
    await boss.stop({ graceful: true, timeout: 25_000 }).catch((err) => log.error({ err }, "stop failed"));
    await closeDb().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

if (!process.env.VITEST) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
