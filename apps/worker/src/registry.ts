/**
 * Job registry: which handlers exist, how they are logged and when they run. Pure and DB-free so it is unit tested.
 * @module @smw/worker/registry
 */
import type { Logger } from "pino";

export type JobHandler = (data: any) => Promise<void>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type JobMap = Record<string, JobHandler>;
export interface JobLike { id: string; data: unknown }

/** Cron schedules for platform jobs. A schedule is only created when a handler for that name is registered. */
export const SCHEDULES: Record<string, { cron: string; tz: string }> = {
  "billing.lifecycle": { cron: "30 1 * * *", tz: "Asia/Kolkata" }, // 01:30 IST daily
  "notifications.email-digest": { cron: "0 8 * * *", tz: "Asia/Kolkata" }, // 08:00 IST daily
  "domains.verify-pending": { cron: "*/10 * * * *", tz: "UTC" }, // every 10 minutes
};

/** Merge job maps. A duplicate name is a wiring bug, so it throws instead of silently overriding. */
export function mergeJobs(...maps: JobMap[]): JobMap {
  const out: JobMap = {};
  for (const m of maps) for (const [name, fn] of Object.entries(m)) {
    if (out[name]) throw new Error(`Duplicate job name: ${name}`);
    out[name] = fn;
  }
  return out;
}

/** Wrap a handler so every job logs name, id, duration and error. Failures are rethrown so pg-boss retries. */
export function withLogging(name: string, fn: JobHandler, log: Logger) {
  return async (jobs: JobLike[]) => {
    for (const job of jobs) {
      const started = Date.now();
      try {
        await fn(job.data ?? {});
        log.info({ job: name, id: job.id, ms: Date.now() - started }, "job done");
      } catch (err) {
        log.error({ job: name, id: job.id, ms: Date.now() - started, err }, "job failed");
        throw err;
      }
    }
  };
}

/** Names that get a cron schedule, given the registered handlers. */
export const scheduledNames = (jobs: JobMap) => Object.keys(SCHEDULES).filter((n) => jobs[n]);
