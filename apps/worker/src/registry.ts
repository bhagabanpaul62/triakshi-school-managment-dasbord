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
  "notifications.digest": { cron: "0 8,18 * * *", tz: "Asia/Kolkata" }, // 08:00 and 18:00 IST; each person gets it at their own hour
  "comms.deliver": { cron: "* * * * *", tz: "UTC" }, // every minute; push and email by priority, budget and quiet hours
  "comms.publish-due": { cron: "* * * * *", tz: "UTC" }, // every minute; scheduled notices, and the end of the 30-second undo
  "comms.response-reminders": { cron: "0 9,17 * * *", tz: "Asia/Kolkata" }, // 09:00 and 17:00 IST; only people who have not answered
  "comms.late-joiners": { cron: "30 2 * * *", tz: "Asia/Kolkata" }, // 02:30 IST daily; new students get live notices without a push
  "comms.expire": { cron: "10 0 * * *", tz: "Asia/Kolkata" }, // 00:10 IST daily; expiry and unpin
  "messages.lapse": { cron: "40 2 * * *", tz: "Asia/Kolkata" }, // 02:40 IST daily; teacher changed or student left
  "messages.retention": { cron: "50 3 * * *", tz: "Asia/Kolkata" }, // 03:50 IST daily; after the school's keeping time, held ones stay
  "requests.clock": { cron: "5 8-18 * * *", tz: "Asia/Kolkata" }, // hourly in office hours; overdue, escalate, auto-close
  "events.reminders": { cron: "*/5 * * * *", tz: "UTC" }, // every 5 minutes; each reminder once
  "events.late-joiners": { cron: "35 2 * * *", tz: "Asia/Kolkata" }, // 02:35 IST daily; new students see the events of their class
  "meetings.reminders": { cron: "*/15 * * * *", tz: "UTC" }, // every 15 minutes; day before, hour before, close and finish
  "comms.cleanup": { cron: "30 3 * * *", tz: "Asia/Kolkata" }, // 03:30 IST daily; keeping rules, dead push devices
  "domains.verify-pending": { cron: "*/10 * * * *", tz: "UTC" }, // every 10 minutes
  "domains.recheck": { cron: "20 4 * * *", tz: "Asia/Kolkata" }, // 04:20 IST daily; every verified domain; failing ones are checked with the pending ones
  "website.publish-due": { cron: "*/5 * * * *", tz: "UTC" }, // every 5 minutes; scheduled publishes
  "website.enquiry-clock": { cron: "10 8-18 * * 1-6", tz: "Asia/Kolkata" }, // hourly in office hours; follow-ups due, first call late
  "website.enquiry-retention": { cron: "15 4 * * *", tz: "Asia/Kolkata" }, // 04:15 IST daily; after the school's keeping time
  "website.document-expiry": { cron: "5 9 * * *", tz: "Asia/Kolkata" }, // 09:05 IST daily; 30 days before and on the day, once each
  "settings.exports": { cron: "* * * * *", tz: "UTC" }, // every minute; queued exports, one at a time per school
  "settings.cleanup": { cron: "25 4 * * *", tz: "Asia/Kolkata" }, // 04:25 IST daily; old export files and sign-in events
  "settings.privacy-due": { cron: "0 10 * * *", tz: "Asia/Kolkata" }, // 10:00 IST daily; 14 days before, on the day, weekly after
  "settings.sign-in-watch": { cron: "*/10 * * * *", tz: "UTC" }, // every 10 minutes; bursts of failed sign-ins, told once an hour
  "setup.snapshot": { cron: "45 2 * * *", tz: "Asia/Kolkata" }, // 02:45 IST daily; how far each school has come, for the console
  "support.tell": { cron: "* * * * *", tz: "UTC" }, // every minute; replies and visits are told to the school once
  "support.clock": { cron: "15 * * * *", tz: "Asia/Kolkata" }, // hourly; reply targets, reminders, auto-solve and close
  "assignments.due-reminders": { cron: "*/15 * * * *", tz: "UTC" }, // every 15 minutes; each assignment is reminded once
  "assignments.publish-due": { cron: "*/5 * * * *", tz: "UTC" }, // every 5 minutes; scheduled drafts go live
  "library.overdue-reminders": { cron: "0 9 * * *", tz: "Asia/Kolkata" }, // 09:00 IST daily; each loan is reminded at most weekly
  "transport.fee-sync": { cron: "0 2 1 * *", tz: "Asia/Kolkata" }, // 02:00 IST on the 1st; idempotent
  "timetable.publish-due": { cron: "15 0 * * *", tz: "Asia/Kolkata" }, // 00:15 IST daily; a scheduled draft goes live before school
  "attendance.send-alerts": { cron: "*/10 * * * *", tz: "UTC" }, // every 10 minutes; alerts wait 30 minutes so a corrected mark never goes out
  "finance.control-checks": { cron: "0 3 * * *", tz: "Asia/Kolkata" }, // 03:00 IST daily; admins hear only of a mismatch
  "fees.issue-invoices": { cron: "0 1 * * *", tz: "Asia/Kolkata" }, // 01:00 IST daily; one bill per student and due key
  "payroll.reminders": { cron: "0 9 * * *", tz: "Asia/Kolkata" }, // 09:00 IST daily; run not started, statutory and exit pay due
  "fees.reminders": { cron: "0 9 * * *", tz: "Asia/Kolkata" }, // 09:00 IST daily; only schools that turned reminders on
  "fees.control-checks": { cron: "15 3 * * *", tz: "Asia/Kolkata" }, // 03:15 IST daily
  "expenses.recurring": { cron: "0 2 * * *", tz: "Asia/Kolkata" }, // 02:00 IST daily; one draft bill per period
  "attendance.leave-credit": { cron: "30 0 * * *", tz: "Asia/Kolkata" }, // 00:30 IST daily; each person, type and leave year is credited once
  "students.join-due": { cron: "10 0 * * *", tz: "Asia/Kolkata" }, // 00:10 IST daily; children whose joining day has come become active, once each
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
