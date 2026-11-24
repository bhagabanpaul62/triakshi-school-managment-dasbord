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
  "assignments.due-reminders": { cron: "*/15 * * * *", tz: "UTC" }, // every 15 minutes; each assignment is reminded once
  "assignments.publish-due": { cron: "*/5 * * * *", tz: "UTC" }, // every 5 minutes; scheduled drafts go live
  "library.overdue-reminders": { cron: "0 9 * * *", tz: "Asia/Kolkata" }, // 09:00 IST daily; each loan is reminded at most weekly
  "transport.fee-sync": { cron: "0 2 1 * *", tz: "Asia/Kolkata" }, // 02:00 IST on the 1st; idempotent
  "timetable.publish-due": { cron: "15 0 * * *", tz: "Asia/Kolkata" }, // 00:15 IST daily; a scheduled draft goes live before school
  "attendance.send-alerts": { cron: "*/10 * * * *", tz: "UTC" }, // every 10 minutes; alerts wait 30 minutes so a corrected mark never goes out
  "attendance.leave-credit": { cron: "30 0 * * *", tz: "Asia/Kolkata" }, // 00:30 IST daily; each person, type and leave year is credited once
  "transport.document-expiry": { cron: "0 9 * * *", tz: "Asia/Kolkata" }, // 09:00 IST daily; 30/7/0-day alerts, once each
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
