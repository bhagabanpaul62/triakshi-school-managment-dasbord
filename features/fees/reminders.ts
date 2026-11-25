import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { rupees, addDays, daysBetween, todayIST } from "@smw/feature-kit/money";
import { z } from "zod";
import { FeesBase, invalid } from "./base";
import { openOf } from "./calc";
import { feeInvoices, feePromises, feeReminderStops, feeReminders } from "./schema";

/** How far back a missed run still catches up; only the latest offset reached is sent, the earlier ones are marked so they never fire later. */
const CATCH_UP_DAYS = 7;
/**
 * The log keeps one row per bill, due date and offset. A reminder sent by hand uses this plus the day number as its
 * offset, so a bill can be reminded once on each day and never collides with the scheduled offsets (-60 to 365).
 */
const MANUAL_BASE = 1_000_000;
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

const remindInput = z.object({ studentIds: z.array(z.uuid()).max(500).optional(), invoiceIds: z.array(z.uuid()).max(500).optional() }).refine((v) => v.studentIds?.length || v.invoiceIds?.length, { message: "Pick who to remind." });
export type SkipReason = "stopped" | "promise" | "nothing_open" | "already_today" | "no_login";

/**
 * Fee reminders for one school, in the school's own offsets (days before and after each due date). One notice per
 * due date and offset, to the family login. Skipped when the school has reminders off, the student is stopped, or a
 * promise to pay still runs. A settlement part is reminded on its own date.
 */
export class ReminderService extends FeesBase {
  /** Returns how many notices were made. Safe to run twice: the marker rows and the notices commit together. */
  async run(today = todayIST()): Promise<number> {
    return this.write("collect", async (tx) => {
      const { remindersOn, reminderDays } = await this.settings(tx);
      if (!remindersOn || !reminderDays.length) return 0;
      const offsets = [...reminderDays].sort((a, b) => a - b);
      // A slice is a candidate while its latest reached offset is inside the catch-up window.
      const latestDue = addDays(today, -offsets[0]!), earliestDue = addDays(today, -offsets.at(-1)! - CATCH_UP_DAYS);
      const slices = [...(await tx.execute<{ invoice_id: string; student_id: string; due_on: string; open_paise: string; label: string }>(sql`
        select s.invoice_id, s.student_id, s.due_on::text due_on, s.open_paise, i.label from (
          select i.id invoice_id, i.student_id, i.due_date due_on, (i.gross_paise - i.concession_paise - i.credited_paise + i.late_paise - i.paid_paise) open_paise from fee_invoices i
            where i.status = 'issued' and not exists (select 1 from fee_due_parts p where p.invoice_id = i.id)
          union all
          select p.invoice_id, i.student_id, p.due_on,
                 greatest(0, least(p.amount_paise, p.cum - greatest(0, p.tot - (i.gross_paise - i.concession_paise - i.credited_paise + i.late_paise - i.paid_paise))))
            from (select invoice_id, due_on, amount_paise, sum(amount_paise) over (partition by invoice_id order by due_on) cum, sum(amount_paise) over (partition by invoice_id) tot from fee_due_parts) p
            join fee_invoices i on i.id = p.invoice_id where i.status = 'issued') s
        join fee_invoices i on i.id = s.invoice_id
        where s.open_paise > 0 and s.due_on between ${earliestDue}::date and ${latestDue}::date
          and not exists (select 1 from fee_reminder_stops x where x.student_id = s.student_id)
          and not exists (select 1 from fee_promises p where p.student_id = s.student_id and p.promised_on >= ${today}::date)`))];
      const picks = slices.flatMap((s) => {
        const reached = offsets.filter((o) => addDays(s.due_on, o) <= today);
        const latest = reached.at(-1);
        return latest === undefined || addDays(s.due_on, latest) < addDays(today, -CATCH_UP_DAYS) ? [] : [{ s, reached, latest }];
      });
      if (!picks.length) return 0;
      // Claim first: only rows this run inserted are its to send, so two runs at once never both notify.
      const claimed = await tx.insert(feeReminders).values(picks.flatMap(({ s, reached }) => reached.map((o) => ({ schoolId: this.ctx.schoolId, invoiceId: s.invoice_id, studentId: s.student_id, offsetDays: o, dueOn: s.due_on, sentOn: today })))).onConflictDoNothing().returning({ invoiceId: feeReminders.invoiceId, dueOn: feeReminders.dueOn, offsetDays: feeReminders.offsetDays });
      const mine = new Set(claimed.map((c) => `${c.invoiceId}:${c.dueOn}:${c.offsetDays}`));
      const send = picks.filter(({ s, latest }) => mine.has(`${s.invoice_id}:${s.due_on}:${latest}`));
      const logins = await this.studentUsers(tx, [...new Set(send.map((p) => p.s.student_id))]);
      const { NotificationWriter } = await import("@smw/feature-notifications/writer");
      return NotificationWriter.insert(tx, this.ctx.schoolId, send.flatMap(({ s }) => {
        const userId = logins.get(s.student_id);
        if (!userId) return [];
        const d = daysBetween(today, s.due_on);
        const when = d > 0 ? `is due in ${d} day${d === 1 ? "" : "s"}` : d === 0 ? "is due today" : `was due ${-d} day${d === -1 ? "" : "s"} ago`;
        return [{ userId, topic: "fees.due" as const, subject: { type: "invoice", id: s.invoice_id }, groupKey: `fee-reminder:${s.invoice_id}`, title: d < 0 ? `Fee overdue: ${s.label}` : `Fee reminder: ${s.label}`, body: `${rupees(Number(s.open_paise))} ${when}.`, href: `/app/fees/invoices/${s.invoice_id}` }];
      }));
    });
  }

  /**
   * "Remind now" from a list: one notice to each family login with what is open (on the picked bills, or on all of
   * a picked student's bills). The same rules as the nightly run: not when the office stopped reminders, not while a
   * promise to pay runs. A bill is reminded once a day. Returns who got one and who was skipped, with why.
   */
  async remindNow(input: unknown) {
    this.authorize("collect", "write");
    const o = this.parse(remindInput, input);
    return this.write("collect", async (tx) => {
      const today = todayIST();
      const asked = o.invoiceIds?.length ? await this.loadInvoices(tx, inArray(feeInvoices.id, o.invoiceIds)) : [];
      const studentIds = [...new Set([...(o.studentIds ?? []), ...asked.map((b) => b.studentId)])];
      if (!studentIds.length) throw invalid("studentIds", "Those bills were not found.");
      const [people, stops, promises, bills, done, logins] = await Promise.all([
        this.studentLines(tx, inArray(sql`students.id`, studentIds)),
        tx.select({ id: feeReminderStops.studentId }).from(feeReminderStops).where(inArray(feeReminderStops.studentId, studentIds)),
        tx.select({ id: feePromises.studentId, on: feePromises.promisedOn }).from(feePromises).where(and(inArray(feePromises.studentId, studentIds), gte(feePromises.promisedOn, today))),
        o.invoiceIds?.length ? Promise.resolve(asked) : this.loadInvoices(tx, and(inArray(feeInvoices.studentId, studentIds), eq(feeInvoices.status, "issued"))),
        tx.select({ id: feeReminders.invoiceId }).from(feeReminders).where(and(eq(feeReminders.offsetDays, MANUAL_BASE + dayNumber(today)))),
        this.studentUsers(tx, studentIds),
      ]);
      const stopped = new Set(stops.map((x) => x.id)), promised = new Map(promises.map((p) => [p.id, p.on])), remindedToday = new Set(done.map((d) => d.id));
      const sent: { studentId: string; name: string; bills: number; totalPaise: number }[] = [], skipped: { studentId: string; name: string; reason: SkipReason; detail: string }[] = [];
      for (const s of people) {
        const skip = (reason: SkipReason, detail: string) => skipped.push({ studentId: s.id, name: s.name, reason, detail });
        if (stopped.has(s.id)) { skip("stopped", "Reminders are stopped for this student."); continue; }
        if (promised.has(s.id)) { skip("promise", `They promised to pay by ${promised.get(s.id)}.`); continue; }
        const open = bills.filter((b) => b.studentId === s.id && b.status === "issued" && openOf(b) > 0);
        if (!open.length) { skip("nothing_open", "Nothing is open."); continue; }
        const fresh = open.filter((b) => !remindedToday.has(b.id));
        if (!fresh.length) { skip("already_today", "Already reminded today."); continue; }
        if (!logins.has(s.id)) { skip("no_login", "The family has no login to send a notice to."); continue; }
        await tx.insert(feeReminders).values(fresh.map((b) => ({ schoolId: this.ctx.schoolId, invoiceId: b.id, studentId: s.id, offsetDays: MANUAL_BASE + dayNumber(today), dueOn: b.dueDate, sentOn: today }))).onConflictDoNothing();
        const total = fresh.reduce((n, b) => n + openOf(b), 0), late = fresh.filter((b) => b.dueDate < today).length;
        await this.tell(tx, [s.id], "fees.due", late ? "Fees are overdue" : "Fee reminder", `${rupees(total)} is open${late ? `, ${late} bill${late === 1 ? " is" : "s are"} past the due date` : ""}. Open your fees to pay.`, "/app/fees");
        sent.push({ studentId: s.id, name: s.name, bills: fresh.length, totalPaise: total });
      }
      return { sent, skipped };
    }, (r) => ({ action: "remind", entity: "Student", summary: `Sent ${r.sent.length} fee reminder${r.sent.length === 1 ? "" : "s"} by hand${r.skipped.length ? `, ${r.skipped.length} skipped` : ""}` }));
  }
}
