// Worker jobs for support. Both write the clock columns, which the school's database role cannot, so they read and claim on the console connection
// and write what people see inside `withSchool`. A claim comes first (`told_at`, `reminded_at`, `overdue_told_at`), so a row is handled once even if a run repeats.
import { and, asc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  platformStaff, plans, schools, supportMessages, supportTickets, supportVisits, users, withConsole, withSchool, type Tx,
} from "@smw/db";
import { env } from "@smw/config";
import { services } from "@smw/integrations";
import { NotificationWriter, type NotificationRow } from "@smw/feature-notifications/writer";
import { ticketRef } from "./labels";
import { addWorkingHours, replyHours, type Priority } from "./sla";

const BATCH = 100;
const DAY = 86_400_000;
export const REMIND_AFTER_DAYS = 3;
export const SOLVE_AFTER_DAYS = 14;
export const CLOSE_AFTER_DAYS = 7;

const log = (msg: string, extra: Record<string, unknown>) => console.error(JSON.stringify({ level: "error", msg, ...extra }));

/** Who is mailed: the support address when `SUPPORT_EMAIL` is set (owners too for overdue ones), else the console's owners and support staff. */
async function recipients(roles: ("owner" | "support")[]): Promise<string[]> {
  const set = env().SUPPORT_EMAIL;
  if (!set) return staffEmails(roles);
  return roles.includes("support") ? [set] : [...new Set([set, ...(await staffEmails(roles))])];
}
const staffEmails = async (roles: ("owner" | "support")[]) =>
  (await withConsole((tx) => tx.select({ email: platformStaff.email }).from(platformStaff).where(and(eq(platformStaff.status, "active"), inArray(platformStaff.role, roles))))).map((r) => r.email);

/** True when the mail is done: sent to at least one person, or nobody exists to send to. False means try again. */
async function mailStaff(roles: ("owner" | "support")[], subject: string, text: string): Promise<boolean> {
  const to = await recipients(roles);
  let sent = 0;
  for (const email of to) {
    try { await services().email.send({ to: email, subject, text }); sent++; } catch (err) { log("support mail failed", { err: String(err) }); }
  }
  return to.length === 0 || sent > 0;
}
/** A failed mail is tried again on the next run, for a day after the ticket was written or came due. */
export const RETRY_MS = DAY;

const consoleLink = (ticketId: string) => `${env().CONSOLE_URL.replace(/\/$/, "")}/support/${ticketId}`;

/** Everyone in the school who wrote in the ticket (including whoever raised it). Disabled people are dropped by the writer. */
async function writers(tx: Tx, ticketId: string, createdBy: string | null): Promise<string[]> {
  const rows = await tx.select({ id: supportMessages.authorUserId }).from(supportMessages).where(and(eq(supportMessages.ticketId, ticketId), isNotNull(supportMessages.authorUserId)));
  return [...new Set([...(createdBy ? [createdBy] : []), ...rows.map((r) => r.id!)])];
}

/** Tell the people who wrote in a ticket: bell, push and mail through the writer, inside the school's own transaction. */
async function tellWriters(schoolId: string, t: { id: string; number: number; createdByUserId: string | null; status: string }, title: string, body: string): Promise<number> {
  return withSchool(schoolId, async (tx) => {
    const ids = await writers(tx, t.id, t.createdByUserId);
    const rows: NotificationRow[] = ids.map((userId) => ({
      userId, topic: "support.reply", title, body, href: `/app/support/${t.id}`, subject: { type: "support_ticket", id: t.id },
      groupKey: `support:${t.id}`, action: t.status === "pending",
    }));
    return NotificationWriter.insert(tx, schoolId, rows);
  });
}

export class SupportJobs {
  /** Every minute: set the reply time of new tickets and tell staff; tell the school of staff messages and of support visits. Each thing once. */
  async tell(now = new Date()): Promise<{ tickets: number; messages: number; visits: number }> {
    const failed: unknown[] = [];
    const each = async <T>(items: T[], one: (item: T) => Promise<unknown>) => { for (const i of items) { try { await one(i); } catch (err) { failed.push(err); log("support tell failed", { err: String(err) }); } } };

    // New tickets: a clock, and a mail to the team.
    const fresh = await withConsole((tx) => tx.select({ t: supportTickets, school: schools.name, planKey: plans.key }).from(supportTickets)
      .innerJoin(schools, eq(schools.id, supportTickets.schoolId)).leftJoin(plans, eq(plans.id, schools.planId))
      .where(and(isNull(supportTickets.replyDueAt), isNull(supportTickets.firstReplyAt), eq(supportTickets.status, "open"))).orderBy(asc(supportTickets.createdAt)).limit(BATCH));
    let tickets = 0;
    await each(fresh, async ({ t, school, planKey }) => {
      const due = addWorkingHours(t.createdAt, replyHours(t.priority as Priority, planKey));
      const claimed = await withConsole((tx) => tx.update(supportTickets).set({ replyDueAt: due }).where(and(eq(supportTickets.id, t.id), isNull(supportTickets.replyDueAt))).returning({ id: supportTickets.id }));
      if (!claimed.length) return;
      tickets++;
      const done = await mailStaff(["owner", "support"], `New ticket ${ticketRef(t.number)}: ${t.subject}`,
        `${school} asked for help.\n\n${t.subject}\nType: ${t.category}. How urgent: ${t.priority}.\nWe aim to reply by ${due.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST.\n\nOpen it: ${consoleLink(t.id)}`);
      // Released again so the next minute tries the mail; after a day it is given up (the console queue still shows the ticket).
      if (!done && now.getTime() - t.createdAt.getTime() < RETRY_MS) { await withConsole((tx) => tx.update(supportTickets).set({ replyDueAt: null }).where(eq(supportTickets.id, t.id))); tickets--; }
    });

    // Staff messages: tell the writers once.
    const fresh2 = await withConsole((tx) => tx.select({ m: supportMessages, t: supportTickets }).from(supportMessages)
      .innerJoin(supportTickets, eq(supportTickets.id, supportMessages.ticketId))
      .where(and(isNotNull(supportMessages.authorStaffId), isNull(supportMessages.toldAt))).orderBy(asc(supportMessages.createdAt)).limit(BATCH));
    let messages = 0;
    await each(fresh2, async ({ m, t }) => {
      const claimed = await withConsole((tx) => tx.update(supportMessages).set({ toldAt: now }).where(and(eq(supportMessages.id, m.id), isNull(supportMessages.toldAt))).returning({ id: supportMessages.id }));
      if (!claimed.length) return;
      try { await tellWriters(m.schoolId, t, `Triakshi replied on ${ticketRef(t.number)}`, m.body.slice(0, 300)); messages++; }
      catch (err) { await withConsole((tx) => tx.update(supportMessages).set({ toldAt: null }).where(eq(supportMessages.id, m.id))); throw err; }
    });

    // Support visits: the school's administrators are told, whatever the school's setting says.
    const fresh3 = await withConsole((tx) => tx.select().from(supportVisits).where(isNull(supportVisits.toldAt)).orderBy(asc(supportVisits.createdAt)).limit(BATCH));
    let visits = 0;
    await each(fresh3, async (v) => {
      const claimed = await withConsole((tx) => tx.update(supportVisits).set({ toldAt: now }).where(and(eq(supportVisits.id, v.id), isNull(supportVisits.toldAt))).returning({ id: supportVisits.id }));
      if (!claimed.length) return;
      try {
        await withSchool(v.schoolId, async (tx) => {
          const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")));
          await NotificationWriter.insert(tx, v.schoolId, admins.map((a) => ({
            userId: a.id, topic: "account.security" as const, urgent: v.emergency,
            title: v.emergency ? "Triakshi support entered your school in an emergency" : "Triakshi support opened a session on your school",
            body: `${v.staffName} signed in as ${v.asUserName} (${v.readOnly ? "read only" : "can make changes"}). Reason: ${v.reason}`,
            href: "/app/settings/access", subject: { type: "support_visit", id: v.id },
          })));
        });
        visits++;
      } catch (err) { await withConsole((tx) => tx.update(supportVisits).set({ toldAt: null }).where(eq(supportVisits.id, v.id))); throw err; }
    });

    if (failed.length) throw new Error(`${failed.length} support item(s) failed: ${String(failed[0])}`);
    return { tickets, messages, visits };
  }

  /**
   * Hourly. Waiting 14 days: solved. Waiting 3 days: a reminder. Solved 7 days: closed. First-reply target missed: flagged, and mailed to the owner.
   */
  async clock(now = new Date()): Promise<{ solved: number; reminded: number; closed: number; overdue: number }> {
    const failed: unknown[] = [];
    const each = async <T>(items: T[], one: (item: T) => Promise<unknown>) => { for (const i of items) { try { await one(i); } catch (err) { failed.push(err); log("support clock failed", { err: String(err) }); } } };
    type Row = typeof supportTickets.$inferSelect;
    const ago = (days: number) => new Date(now.getTime() - days * DAY);

    const solve = await withConsole((tx) => tx.select().from(supportTickets).where(and(eq(supportTickets.status, "pending"), lte(supportTickets.pendingSince, ago(SOLVE_AFTER_DAYS)))).limit(BATCH));
    let solved = 0;
    await each(solve, async (t: Row) => {
      const c = await withConsole((tx) => tx.update(supportTickets).set({ status: "resolved", resolvedAt: now, pendingSince: null, updatedAt: now })
        .where(and(eq(supportTickets.id, t.id), eq(supportTickets.status, "pending"))).returning({ id: supportTickets.id }));
      if (!c.length) return;
      solved++;
      try { await tellWriters(t.schoolId, { ...t, status: "resolved" }, `${ticketRef(t.number)} was marked solved`, `We had no answer for ${SOLVE_AFTER_DAYS} days. If it is not solved, open the ticket and reopen it.`); }
      catch (err) {
        // The school was not told: put the ticket back so the next run tries again (for a day past the limit; after that it stays solved).
        if (t.pendingSince && now.getTime() - t.pendingSince.getTime() < (SOLVE_AFTER_DAYS * DAY + RETRY_MS)) { await withConsole((tx) => tx.update(supportTickets).set({ status: "pending", resolvedAt: null, pendingSince: t.pendingSince }).where(eq(supportTickets.id, t.id))); solved--; }
        throw err;
      }
    });

    const remind = await withConsole((tx) => tx.select().from(supportTickets).where(and(eq(supportTickets.status, "pending"), isNull(supportTickets.remindedAt), lte(supportTickets.pendingSince, ago(REMIND_AFTER_DAYS)))).limit(BATCH));
    let reminded = 0;
    await each(remind, async (t: Row) => {
      const c = await withConsole((tx) => tx.update(supportTickets).set({ remindedAt: now }).where(and(eq(supportTickets.id, t.id), isNull(supportTickets.remindedAt))).returning({ id: supportTickets.id }));
      if (!c.length) return;
      reminded++;
      try { await tellWriters(t.schoolId, t, `We are waiting for your answer on ${ticketRef(t.number)}`, "Open the ticket and reply, or mark it solved if you no longer need help."); }
      catch (err) { await withConsole((tx) => tx.update(supportTickets).set({ remindedAt: null }).where(eq(supportTickets.id, t.id))); throw err; }
    });

    const close = await withConsole((tx) => tx.select({ id: supportTickets.id }).from(supportTickets).where(and(eq(supportTickets.status, "resolved"), lte(supportTickets.resolvedAt, ago(CLOSE_AFTER_DAYS)))).limit(BATCH));
    const closed = close.length ? (await withConsole((tx) => tx.update(supportTickets).set({ status: "closed", closedAt: now, updatedAt: now })
      .where(and(inArray(supportTickets.id, close.map((c) => c.id)), eq(supportTickets.status, "resolved"))).returning({ id: supportTickets.id }))).length : 0;

    const late = await withConsole((tx) => tx.select({ t: supportTickets, school: schools.name }).from(supportTickets).innerJoin(schools, eq(schools.id, supportTickets.schoolId))
      .where(and(isNull(supportTickets.firstReplyAt), isNull(supportTickets.overdueToldAt), isNotNull(supportTickets.replyDueAt), lte(supportTickets.replyDueAt, now), sql`${supportTickets.status} in ('open', 'pending')`)).limit(BATCH));
    let overdue = 0;
    await each(late, async ({ t, school }) => {
      const c = await withConsole((tx) => tx.update(supportTickets).set({ overdueToldAt: now }).where(and(eq(supportTickets.id, t.id), isNull(supportTickets.overdueToldAt))).returning({ id: supportTickets.id }));
      if (!c.length) return;
      overdue++;
      const done = await mailStaff(["owner"], `Overdue ${ticketRef(t.number)}: ${t.subject}`, `${school} has had no first reply by the target time.\n\n${t.subject}\nHow urgent: ${t.priority}.\n\nOpen it: ${consoleLink(t.id)}`);
      if (!done && now.getTime() - t.replyDueAt!.getTime() < RETRY_MS) { await withConsole((tx) => tx.update(supportTickets).set({ overdueToldAt: null }).where(eq(supportTickets.id, t.id))); overdue--; }
    });

    if (failed.length) throw new Error(`${failed.length} support item(s) failed: ${String(failed[0])}`);
    return { solved, reminded, closed, overdue };
  }
}

/** Run by the worker: every minute and every hour. */
export default {
  "support.tell": async () => new SupportJobs().tell(),
  "support.clock": async () => new SupportJobs().clock(),
} satisfies Record<string, () => Promise<unknown>>;
