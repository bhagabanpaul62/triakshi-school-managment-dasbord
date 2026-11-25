// Worker jobs. Each one runs school by school; one school failing never stops the rest (same pattern as assignments).
import { and, asc, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { schools, withConsole } from "@smw/db";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { SchoolService, systemCtx, type Ctx } from "@smw/feature-kit";
import { type Perm } from "./base";
import { closeForAll, addLateJoiners, fanOut } from "./fan-out";
import announcementsFeature from "./feature";
import { startSending } from "./lifecycle";
import { remindUnanswered } from "./report-service";
import { announcements } from "./schema";
import { LATE_JOIN_DAYS } from "./constants";
import { transition } from "./state";

const SEND_TRIES = 3;

class NoticeJobs extends SchoolService<Perm> {
  protected feature = announcementsFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /**
   * The minute run. Scheduled notices whose time has come start sending; sending notices past their undo time go out; notices past
   * their end date move to Archive; rows asking for an answer close when the last date passes. Each notice stands alone: one that
   * fails never holds back the rest, and the run fails at the end so the queue retries it.
   */
  async publishDue(now: Date): Promise<number> {
    const failed: unknown[] = [];
    const each = async (ids: string[], one: (id: string) => Promise<unknown>) => { for (const id of ids) { try { await one(id); } catch (err) { failed.push(err); console.error(JSON.stringify({ level: "error", msg: "notice failed", id, err: String(err) })); } } };
    const due = await this.write("manage", (tx) => tx.select({ id: announcements.id }).from(announcements).where(and(eq(announcements.state, "scheduled"), lte(announcements.scheduledAt, now))).orderBy(asc(announcements.scheduledAt), asc(announcements.id)));
    await each(due.map((d) => d.id), (id) => this.write("manage", async (tx) => {
      const [n] = await tx.select().from(announcements).where(and(eq(announcements.id, id), eq(announcements.state, "scheduled"))).for("update", { skipLocked: true });
      if (!n) return;
      transition(n.state, "due");
      await startSending(tx, n, { immediate: true, now });
      await this.audit(tx, { action: "publish", entity: "Notice", entityId: n.id, summary: `Sent scheduled notice "${n.title}"` });
    }));
    const ready = await this.write("manage", (tx) => tx.select({ id: announcements.id }).from(announcements).where(and(eq(announcements.state, "sending"), lte(announcements.sendAt, now), isNull(announcements.fannedOutAt))).orderBy(asc(announcements.sendAt), asc(announcements.id)));
    await each(ready.map((r) => r.id), async (id) => {
      try { await fanOut(this.ctx.schoolId, id, now); } catch (err) { await this.sendFailed(id, err, now); throw err; }
    });
    await each(["expire"], () => this.expire(now));
    await each(["close"], () => this.closeDue(now));
    if (failed.length) throw new Error(`${failed.length} notice step(s) failed: ${String(failed[0])}`);
    return ready.length;
  }

  /**
   * A send that failed again. The count lives in the review note ("Sending failed 2 times: ..."), so a notice that can never go out does not
   * stay "sending" for ever: on the third failure it goes back to a draft with the reason, and the writer gets an action row.
   */
  private sendFailed(id: string, err: unknown, now: Date): Promise<void> {
    const why = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    return this.write("manage", async (tx) => {
      const [n] = await tx.select().from(announcements).where(and(eq(announcements.id, id), eq(announcements.state, "sending"))).for("update");
      if (!n) return;
      const times = Number(/^Sending failed (\d+) time/.exec(n.reviewNote ?? "")?.[1] ?? 0) + 1;
      if (times < SEND_TRIES) { await tx.update(announcements).set({ reviewNote: `Sending failed ${times} time${times > 1 ? "s" : ""}: ${why}` }).where(eq(announcements.id, id)); return; }
      const note = `Could not be sent: ${why}`;
      await tx.update(announcements).set({ state: transition(n.state, "undo") as "draft", reviewNote: note, sendAt: null, publishedAt: null, submittedAt: null, updatedAt: now }).where(eq(announcements.id, id));
      if (n.createdBy) {
        await NotificationWriter.insert(tx, this.ctx.schoolId, [{ userId: n.createdBy, topic: "work.update", title: `${note}: ${n.title}`, href: `/app/announcements/${id}`, subject: { type: "notice-review", id }, action: true }]);
      }
      await this.audit(tx, { action: "send-failed", entity: "Notice", entityId: id, summary: `Could not send "${n.title}" after ${SEND_TRIES} tries: ${why}` });
    });
  }

  /** The last date has passed: the "answer me" rows of that notice close, so no one is asked for what can no longer be given. */
  closeDue(now: Date): Promise<number> {
    return this.write("manage", async (tx) => {
      const late = await tx.select({ id: announcements.id }).from(announcements).where(and(eq(announcements.state, "published"), isNotNull(announcements.dueAt), lte(announcements.dueAt, now),
        sql`exists (select 1 from notifications x where x.subject_type = 'notice' and x.subject_id = ${announcements.id}::text and x.action and x.done_at is null)`));
      for (const n of late) await closeForAll(tx, this.ctx.schoolId, n.id);
      return late.length;
    });
  }

  /** Remind people who have not answered: two days before the last date, on it, and the day after. At most once a day each. */
  remind(now: Date): Promise<number> {
    return this.write("manage", async (tx) => {
      const day = (d: unknown) => sql`((${d}) at time zone 'Asia/Kolkata')::date`;
      const open = await tx.select().from(announcements).where(and(eq(announcements.state, "published"), isNotNull(announcements.dueAt), sql`${announcements.response}->>'kind' <> 'none'`,
        sql`(case ${day(announcements.dueAt)} - ${day(sql`${now.toISOString()}::timestamptz`)} when 2 then ${announcements.reminders}->>'before' when 0 then ${announcements.reminders}->>'onDay' when -1 then ${announcements.reminders}->>'after' end) = 'true'`));
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
