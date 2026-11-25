// The two clocks of the enquiry desk. Each runs school by school; one school failing never stops the rest, and the run fails at the end so the queue retries it.
import { and, eq, inArray, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { schools, withConsole } from "@smw/db";
import { systemCtx, type Ctx } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { EnquiryBase, OPEN_STAGES, doomedWhere, istDay, istEnd, loadEnquirySettings } from "./enquiry-core";
import { enquiries, enquiryTasks } from "./schema";

const time = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export class EnquiryClock extends EnquiryBase {
  constructor(ctx: Ctx) { super(ctx); }

  /**
   * Hourly in office hours. A next step that has come due tells its owner once (a visit tells them on the day), and a new enquiry
   * nobody has called by the school's target tells its owner and the admins once. Each is claimed with one update, so a second run does nothing.
   */
  async clock(now = new Date()): Promise<{ reminded: number; late: number }> {
    return this.write("pipeline", async (tx) => {
      const endOfDay = istEnd(istDay(now));
      const open = and(isNull(enquiryTasks.doneAt), isNull(enquiryTasks.remindedAt), isNull(enquiries.mergedInto), inArray(enquiries.status, OPEN_STAGES),
        or(and(eq(enquiryTasks.kind, "visit"), lt(enquiryTasks.dueAt, endOfDay)), and(ne(enquiryTasks.kind, "visit"), lte(enquiryTasks.dueAt, now))));
      const due = await tx.select({ t: enquiryTasks, e: enquiries }).from(enquiryTasks).innerJoin(enquiries, eq(enquiries.id, enquiryTasks.enquiryId)).where(open).orderBy(enquiryTasks.dueAt).limit(500);
      let reminded = 0;
      const everyone = await this.holders(tx);
      for (const { t, e } of due) {
        const [claimed] = await tx.update(enquiryTasks).set({ remindedAt: now }).where(and(eq(enquiryTasks.id, t.id), isNull(enquiryTasks.remindedAt))).returning({ id: enquiryTasks.id });
        if (!claimed) continue;
        const who = t.ownerId ?? e.ownerId;
        const to = (await this.activeOwner(tx, who)) ? [who!] : everyone;
        const title = t.kind === "visit" ? `Visit today at ${time(t.dueAt)}: ${e.studentName}` : `Follow-up due: ${t.title ?? t.kind} for ${e.studentName}`;
        reminded += await NotificationWriter.insert(tx, this.ctx.schoolId, to.map((userId) => ({
          userId, topic: "enquiry.followup" as const, title, href: `/app/enquiries/${e.id}`, subject: { type: "enquiry", id: e.id }, groupKey: `enquiry:${e.id}:followup`, action: true, privateBody: true,
        })));
      }

      const slow = await tx.select().from(enquiries).where(and(eq(enquiries.status, "new"), isNull(enquiries.firstContactAt), isNull(enquiries.lateToldAt), isNull(enquiries.mergedInto), lt(enquiries.callDueAt, now))).limit(500);
      let late = 0;
      const admins = await this.holders(tx, "pipeline");
      for (const e of slow) {
        const [claimed] = await tx.update(enquiries).set({ lateToldAt: now }).where(and(eq(enquiries.id, e.id), isNull(enquiries.lateToldAt))).returning({ id: enquiries.id });
        if (!claimed) continue;
        const to = [...new Set([...((await this.activeOwner(tx, e.ownerId)) ? [e.ownerId!] : []), ...admins])];
        late += await NotificationWriter.insert(tx, this.ctx.schoolId, to.map((userId) => ({
          userId, topic: "enquiry.followup" as const, title: `Nobody has called ${e.parentName} yet`, body: "The school's first-call target has passed.", href: `/app/enquiries/${e.id}`,
          subject: { type: "enquiry", id: e.id }, groupKey: `enquiry:${e.id}:late`, action: true, privateBody: true,
        })));
      }
      return { reminded, late };
    });
  }

  async wouldDelete(months: number, now = new Date()): Promise<number> {
    return this.read("pipeline", async (tx) => (await tx.select({ n: sql<number>`count(*)::int` }).from(enquiries).where(doomedWhere(months, now)))[0]!.n);
  }

  /**
   * Daily. Enquiries nobody touched for the school's keeping time (24 months unless changed) are deleted, with their timeline. Waitlisted
   * and offered children wait twice as long unless somebody closes them. An admitted child stays: the enquiry is the record of where the
   * student came from. The count goes in the audit log.
   */
  async retention(now = new Date()): Promise<number> {
    return this.write("pipeline", async (tx) => {
      const { keepMonths } = await loadEnquirySettings(tx);
      const gone = await tx.delete(enquiries).where(doomedWhere(keepMonths, now)).returning({ id: enquiries.id });
      if (gone.length) await this.audit(tx, { action: "delete", entity: "Enquiry", summary: `Deleted ${gone.length} enquiries not touched for ${keepMonths} months`, meta: { count: gone.length, keepMonths } });
      return gone.length;
    });
  }
}

async function everySchool(name: string, run: (ctx: Ctx) => Promise<unknown>) {
  const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")))).map((s) => s.id);
  let failed = 0;
  for (const id of ids) {
    try { await run(systemCtx(id, ["website"])); }
    catch (err) { failed++; console.error(JSON.stringify({ level: "error", msg: `${name} failed`, schoolId: id, err: String(err) })); }
  }
  if (failed) throw new Error(`${name} failed for ${failed} of ${ids.length} schools`);
}

export const enquiryJobs: Record<string, () => Promise<unknown>> = {
  "website.enquiry-clock": () => everySchool("website.enquiry-clock", (ctx) => new EnquiryClock(ctx).clock()),
  "website.enquiry-retention": () => everySchool("website.enquiry-retention", (ctx) => new EnquiryClock(ctx).retention()),
};
