import { sql } from "drizzle-orm";
import { rupees, addDays, daysBetween, todayIST } from "@smw/feature-kit/money";
import { FeesBase } from "./base";
import { feeReminders } from "./schema";

/** How far back a missed run still catches up; only the latest offset reached is sent, the earlier ones are marked so they never fire later. */
const CATCH_UP_DAYS = 7;

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
        return [{ userId, kind: "fee_due" as const, title: d < 0 ? `Fee overdue: ${s.label}` : `Fee reminder: ${s.label}`, body: `${rupees(Number(s.open_paise))} ${when}.`, href: `/app/fees/invoices/${s.invoice_id}` }];
      }));
    });
  }
}
