import { eq } from "drizzle-orm";
import { ConflictError, systemCtx, type Ctx } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { students } from "@smw/feature-students/schema";
import { FeeCalculator, rupees } from "./calculator";
import { FeesService, todayIST } from "./service";
import { feeReminders } from "./schema";

/** How far back a missed run still catches up. A reminder is sent once per installment, so a wider window cannot spam. */
const CATCH_UP_DAYS = 7;

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const human = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** One school's overdue reminders: tell each student login (the family login) once per installment that fell overdue in the last few days and is still unpaid. */
export class FeeReminders extends FeesService {
  constructor(ctx: Ctx) { super(ctx); }

  /** Returns how many notifications were created. Idempotent: the marker row and the notification commit together. */
  async run(today = todayIST()): Promise<number> {
    const from = addDays(today, -CATCH_UP_DAYS);
    return this.write("manage", async (tx) => {
      let year;
      try { year = await this.currentYear(tx); } catch (e) { if (e instanceof ConflictError) return 0; throw e; }
      const kids = await this.studentLines(tx, eq(students.status, "active"));
      const books = await this.loadBooks(tx, kids, year.id, today);
      const due = kids.flatMap((k) => new FeeCalculator(books.get(k.id)!.input).statement().lines
        .filter((l) => !l.charge && l.overdue && l.due > 0 && l.dueDate >= from && l.dueDate < today)
        .map((l) => ({ student: k, line: l })));
      if (!due.length) return 0;

      // Claim first: only rows we inserted are ours to notify, so two runs at once never both send.
      const claimed = await tx.insert(feeReminders).values(due.map((d) => ({
        schoolId: this.ctx.schoolId, installmentId: d.line.installmentId, studentId: d.student.id, kind: "overdue" as const, sentOn: today,
      }))).onConflictDoNothing().returning({ installmentId: feeReminders.installmentId, studentId: feeReminders.studentId });
      const mine = new Set(claimed.map((c) => `${c.studentId}:${c.installmentId}`));
      const fresh = due.filter((d) => mine.has(`${d.student.id}:${d.line.installmentId}`));

      const logins = await this.studentUsers(tx, [...new Set(fresh.map((d) => d.student.id))]);
      const rows = fresh.flatMap((d) => (logins.has(d.student.id) ? [{
        userId: logins.get(d.student.id)!, kind: "fee_due" as const, title: `Fee overdue: ${d.line.name}`,
        body: `${rupees(d.line.due)} was due on ${human(d.line.dueDate)}.`, href: `/app/fees/students/${d.student.id}`,
      }] : []));
      return NotificationWriter.insert(tx, this.ctx.schoolId, rows);
    });
  }
}

/** The worker job "fees.overdue-reminders": every given school, once. One school failing does not stop the rest; the run fails at the end so the queue retries (safe: it is idempotent). */
export class FeeReminderJob {
  constructor(private readonly schoolIds: string[], private readonly today = todayIST()) {}

  async run(): Promise<{ schools: number; sent: number; failed: number }> {
    const out = { schools: this.schoolIds.length, sent: 0, failed: 0 };
    for (const id of this.schoolIds) {
      try { out.sent += await new FeeReminders(systemCtx(id, ["fees"])).run(this.today); }
      catch (err) { out.failed++; console.error(JSON.stringify({ level: "error", msg: "fee reminders failed", schoolId: id, err: String(err) })); }
    }
    if (out.failed) throw new Error(`Fee reminders failed for ${out.failed} of ${out.schools} schools`);
    return out;
  }
}
