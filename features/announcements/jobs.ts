// Worker jobs. Each one runs school by school; one school failing never stops the rest (same pattern as assignments).
import { and, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { schools, withConsole } from "@smw/db";
import { SchoolService, systemCtx, type Ctx } from "@smw/feature-kit";
import { type Perm } from "./base";
import { closeForAll, addLateJoiners, fanOut } from "./fan-out";
import announcementsFeature from "./feature";
import { startSending } from "./lifecycle";
import { remindUnanswered } from "./report-service";
import { announcements } from "./schema";
import { LATE_JOIN_DAYS } from "./constants";
import { transition } from "./state";

class NoticeJobs extends SchoolService<Perm> {
  protected feature = announcementsFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** Scheduled notices whose time has come start sending; sending notices past their undo time go out. */
  async publishDue(now: Date): Promise<number> {
    const ready = await this.write("manage", async (tx) => {
      const due = await tx.select().from(announcements).where(and(eq(announcements.state, "scheduled"), lte(announcements.scheduledAt, now))).for("update", { skipLocked: true });
      for (const n of due) {
        transition(n.state, "due");
        await startSending(tx, this.ctx.schoolId, n, { immediate: true, now });
        await this.audit(tx, { action: "publish", entity: "Notice", entityId: n.id, summary: `Sent scheduled notice "${n.title}"` });
      }
      return (await tx.select({ id: announcements.id }).from(announcements).where(and(eq(announcements.state, "sending"), lte(announcements.sendAt, now), isNull(announcements.fannedOutAt)))).map((r) => r.id);
    });
    for (const id of ready) await fanOut(this.ctx.schoolId, id, now);
    return ready.length;
  }

  /** Remind people who have not answered: two days before the last date, on it, and the day after. At most once a day each. */
  remind(now: Date): Promise<number> {
    return this.write("manage", async (tx) => {
      const day = (d: unknown) => sql`((${d}) at time zone 'Asia/Kolkata')::date`;
      const open = await tx.select().from(announcements).where(and(eq(announcements.state, "published"), eq(announcements.remind, true), isNotNull(announcements.dueAt), sql`${announcements.response}->>'kind' <> 'none'`,
        sql`${day(announcements.dueAt)} - ${day(sql`${now.toISOString()}::timestamptz`)} in (2, 0, -1)`));
      let sent = 0;
      for (const n of open) sent += (await remindUnanswered(tx, this.ctx.schoolId, n, now)).sent;
      return sent;
    });
  }

  /** New joiners of a class get its live notices quietly, until 30 days after publish. Notices aimed at fee dues are skipped: that list moves every day. */
  lateJoiners(now: Date): Promise<number> {
    return this.write("manage", async (tx) => {
      const live = await tx.select().from(announcements).where(and(eq(announcements.state, "published"), gt(announcements.publishedAt, new Date(now.getTime() - LATE_JOIN_DAYS * 86_400_000)),
        or(isNull(announcements.expiresAt), gt(announcements.expiresAt, now)), sql`not (${announcements.audience}::text like '%"fee_overdue"%')`));
      let added = 0;
      for (const n of live) added += await addLateJoiners(tx, this.ctx.schoolId, n, now);
      return added;
    });
  }

  /** Notices past their end date move to Archive and stop asking for answers. */
  expire(now: Date): Promise<number> {
    return this.write("manage", async (tx) => {
      const gone = await tx.update(announcements).set({ state: transition("published", "expire") as "expired", updatedAt: now })
        .where(and(eq(announcements.state, "published"), isNotNull(announcements.expiresAt), lte(announcements.expiresAt, now))).returning({ id: announcements.id });
      for (const g of gone) await closeForAll(tx, this.ctx.schoolId, g.id);
      return gone.length;
    });
  }
}

/** Every active school, one at a time. The run fails at the end if any school failed, so the queue retries it. */
async function eachSchool(job: string, run: (jobs: NoticeJobs) => Promise<number>): Promise<number> {
  const rows = await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")));
  let total = 0, failed = 0;
  for (const { id } of rows) {
    try { total += await run(new NoticeJobs(systemCtx(id, ["announcements", "notifications"]))); }
    catch (err) { failed++; console.error(JSON.stringify({ level: "error", msg: "notice job failed", job, schoolId: id, err: String(err) })); }
  }
  if (failed) throw new Error(`${job} failed for ${failed} of ${rows.length} schools`);
  return total;
}

export const publishDue = (now = new Date()) => eachSchool("comms.publish-due", (j) => j.publishDue(now));
export const responseReminders = (now = new Date()) => eachSchool("comms.response-reminders", (j) => j.remind(now));
export const lateJoiners = (now = new Date()) => eachSchool("comms.late-joiners", (j) => j.lateJoiners(now));
export const expireNotices = (now = new Date()) => eachSchool("comms.expire", (j) => j.expire(now));
export { NoticeJobs };

export default {
  "comms.publish-due": async () => { await publishDue(); },
  "comms.response-reminders": async () => { await responseReminders(); },
  "comms.late-joiners": async () => { await lateJoiners(); },
  "comms.expire": async () => { await expireNotices(); },
} satisfies Record<string, () => Promise<unknown>>;
