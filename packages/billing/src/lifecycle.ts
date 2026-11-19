import { schoolUrl } from "@smw/config";
import { and, eq, inArray, isNull, lt, lte, schools, sql, subscriptions, users, uuidv7, withConsole, type Tx } from "@smw/db";
import { emailHtml, services } from "@smw/integrations";
import { addDays } from "./util";

export interface LifecycleReport {
  trialsEnded: number; suspended: number; deletionScheduled: number; pastDue: number; readOnly: number; remindersSent: number;
}

const REMINDER_OFFSETS = [-7, 0, 7] as const; // days after the period end: -7 means a week before
const REMINDER_WINDOW_DAYS = 3;

/**
 * The daily clock for school accounts, run by the worker. Each stage looks at how long a school has sat in its
 * current status (`status_changed_at`), so one run moves a school at most one step and a missed day only delays it.
 *   trial ended -> read_only (14 days) -> suspended (90 days) -> deletion scheduled
 *   paid period ended -> past_due (15 days) -> read_only
 * A successful payment (Settlement) puts the school back to active, so "no payment" is implied by the status.
 */
export class LifecycleService {
  async runDaily(now = new Date()): Promise<LifecycleReport> {
    const aged = (days: number) => sql`coalesce(${schools.statusChangedAt}, ${schools.createdAt}) <= ${addDays(now, -days).toISOString()}::timestamptz`;
    const report = await withConsole(async (tx) => {
      // Later stages first, so a school never skips two stages in one run.
      const scheduled = await tx.update(schools).set({ deletionScheduledAt: now })
        .where(and(eq(schools.status, "suspended"), aged(90), isNull(schools.deletionScheduledAt))).returning({ id: schools.id });
      const suspended = await tx.update(schools).set({ status: "suspended", statusChangedAt: now })
        .where(and(eq(schools.status, "read_only"), aged(14))).returning({ id: schools.id });
      const readOnlyLate = await tx.update(schools).set({ status: "read_only", statusChangedAt: now })
        .where(and(eq(schools.status, "past_due"), aged(15))).returning({ id: schools.id });
      const lapsed = await tx.update(subscriptions).set({ status: "past_due" })
        .where(and(eq(subscriptions.status, "active"), lt(subscriptions.currentPeriodEnd, now))).returning({ schoolId: subscriptions.schoolId });
      const pastDue = lapsed.length
        ? await tx.update(schools).set({ status: "past_due", statusChangedAt: now })
          .where(and(eq(schools.status, "active"), inArray(schools.id, lapsed.map((l) => l.schoolId)))).returning({ id: schools.id })
        : [];
      const trials = await tx.update(schools).set({ status: "read_only", statusChangedAt: now })
        .where(and(eq(schools.status, "trial"), lte(schools.trialEndsAt, now))).returning({ id: schools.id });
      return {
        scheduledIds: scheduled.map((s) => s.id),
        counts: { trialsEnded: trials.length, suspended: suspended.length, deletionScheduled: scheduled.length, pastDue: pastDue.length, readOnly: readOnlyLate.length },
      };
    });
    for (const id of report.scheduledIds) await this.sendFinalNotice(id);
    return { ...report.counts, remindersSent: await this.sendReminders(now) };
  }

  /** Renewal emails at 7 days before, on, and 7 days after the period end. Each (subscription, period, offset) is sent once. */
  async sendReminders(now = new Date()): Promise<number> {
    const subs = await withConsole((tx) => tx.select().from(subscriptions).where(and(inArray(subscriptions.status, ["active", "past_due"]))));
    let sent = 0;
    for (const sub of subs) {
      if (!sub.currentPeriodEnd) continue;
      const due = REMINDER_OFFSETS.map((o) => ({ offset: o, at: addDays(sub.currentPeriodEnd!, o) })).filter((d) => d.at <= now);
      const latest = due.sort((a, b) => b.at.getTime() - a.at.getTime())[0];
      if (!latest || now.getTime() - latest.at.getTime() > REMINDER_WINDOW_DAYS * 86_400_000) continue;
      const claimed = await withConsole(async (tx) => {
        const rows = await tx.execute(sql`insert into billing_reminders (id, subscription_id, period_key, offset_days)
          values (${uuidv7()}, ${sub.id}, ${sub.currentPeriodEnd!.toISOString()}, ${latest.offset}) on conflict do nothing returning id`);
        return rows.length > 0;
      });
      if (!claimed) continue;
      try {
        if (await this.mailRenewal(sub.schoolId, latest.offset, sub.currentPeriodEnd)) sent++;
        else await this.release(sub.id, sub.currentPeriodEnd, latest.offset);
      } catch (err) {
        console.error(JSON.stringify({ level: "error", msg: "renewal reminder failed", err: String(err), subscription: sub.id }));
        await this.release(sub.id, sub.currentPeriodEnd, latest.offset);
      }
    }
    return sent;
  }

  private release(subscriptionId: string, end: Date, offset: number) {
    return withConsole((tx) => tx.execute(sql`delete from billing_reminders where subscription_id = ${subscriptionId} and period_key = ${end.toISOString()} and offset_days = ${offset}`));
  }

  private async contact(tx: Tx, schoolId: string) {
    const [school] = await tx.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
    if (!school) return null;
    const [admin] = school.email ? [] : await tx.select({ email: users.email }).from(users).where(and(eq(users.schoolId, schoolId), eq(users.role, "admin"), eq(users.status, "active"))).limit(1);
    const to = school.email ?? admin?.email ?? null;
    return to ? { to, school } : null;
  }

  private async mailRenewal(schoolId: string, offset: number, end: Date): Promise<boolean> {
    const c = await withConsole((tx) => this.contact(tx, schoolId));
    if (!c) return false;
    const date = end.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
    const [subject, body] = offset === -7
      ? [`Your Triakshi plan renews on ${date}`, `Your plan for ${c.school.name} ends on ${date}. Renew before then so nothing is interrupted.`]
      : offset === 0
        ? [`Your Triakshi plan ends today`, `Your plan for ${c.school.name} ends today. Renew now to keep your school open for everyone.`]
        : [`Payment overdue for ${c.school.name}`, `Your plan ended on ${date} and we have not received a payment. The school becomes read-only soon. Renew to keep everything open.`];
    const url = schoolUrl(c.school.slug, "/app/billing");
    await services().email.send({ to: c.to, subject, text: `${body}\n\nRenew: ${url}`, html: emailHtml(subject, `<p>${body}</p>`, { label: "Go to billing", url }) });
    return true;
  }

  private async sendFinalNotice(schoolId: string) {
    try {
      const c = await withConsole((tx) => this.contact(tx, schoolId));
      if (!c) return;
      const subject = `Final notice: ${c.school.name} will be deleted`;
      const body = `${c.school.name} has been suspended for 90 days without a payment, so its data is scheduled for deletion. Renew now to keep it, and export what you need first.`;
      const url = schoolUrl(c.school.slug, "/app/billing");
      await services().email.send({ to: c.to, subject, text: `${body}\n\n${url}`, html: emailHtml(subject, `<p>${body}</p>`, { label: "Renew now", url }) });
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "final notice failed", err: String(err), school: schoolId }));
    }
  }
}
