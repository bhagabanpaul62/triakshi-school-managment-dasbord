import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { SchoolService, systemCtx, type Ctx } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { students } from "@smw/feature-students/schema";
import libraryFeature from "./feature";
import { REMINDER_EVERY_DAYS, addDays, daysLate, todayIST } from "./rules";
import { bookCopies, books, loans } from "./schema";

/** One school's overdue reminders: a notice to the borrower's login (the writer sends the email by their preferences), at most once a week per loan. */
export class OverdueReminders extends SchoolService<"read" | "manage" | "self"> {
  protected feature = libraryFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** Returns how many loans were reminded. Idempotent within a day: claiming a loan (stamping `last_reminder_on`) and its notice commit together. */
  async run(today = todayIST()): Promise<{ reminded: number }> {
    const reminded = await this.write("manage", async (tx) => {
      const claimed = await tx.update(loans).set({ lastReminderOn: today })
        .where(and(isNull(loans.returnedOn), lt(loans.dueOn, today), or(isNull(loans.lastReminderOn), lt(loans.lastReminderOn, addDays(today, -(REMINDER_EVERY_DAYS - 1))))))
        .returning({ id: loans.id, copyId: loans.copyId, dueOn: loans.dueOn, studentId: loans.studentId, userId: loans.userId });
      if (!claimed.length) return 0;
      const [titles, studs] = await Promise.all([
        tx.select({ copyId: bookCopies.id, title: books.title }).from(bookCopies).innerJoin(books, eq(books.id, bookCopies.bookId)).where(inArray(bookCopies.id, claimed.map((c) => c.copyId))),
        tx.select({ id: students.id, userId: students.userId }).from(students).where(inArray(students.id, claimed.flatMap((c) => (c.studentId ? [c.studentId] : [])).concat("00000000-0000-0000-0000-000000000000"))),
      ]);
      const targets = claimed.flatMap((c) => {
        const userId = c.studentId ? studs.find((s) => s.id === c.studentId)?.userId : c.userId;
        const title = titles.find((t) => t.copyId === c.copyId)?.title ?? "A library book";
        return userId ? [{ loanId: c.id, userId, title, days: daysLate(c.dueOn, today), dueOn: c.dueOn }] : [];
      });
      await NotificationWriter.insert(tx, this.ctx.schoolId, targets.map((t) => ({
        userId: t.userId, topic: "library.due" as const, subject: { type: "loan", id: t.loanId }, title: `Library book overdue: ${t.title}`, body: `It was due on ${t.dueOn} and is ${t.days} ${t.days === 1 ? "day" : "days"} late. Please return it to the library.`, href: "/app/library",
      })));
      return targets.length;
    }, (n) => ({ action: "overdue_reminders", entity: "Loan", summary: `Sent ${n} overdue ${n === 1 ? "reminder" : "reminders"}` }));

    return { reminded };
  }
}

/** The worker job "library.overdue-reminders": every given school, once. One school failing does not stop the rest; the run fails at the end so the queue retries (safe: a loan is reminded once a week). */
export class OverdueReminderJob {
  constructor(private readonly schoolIds: string[], private readonly today = todayIST()) {}

  async run(): Promise<{ schools: number; reminded: number; failed: number }> {
    const out = { schools: this.schoolIds.length, reminded: 0, failed: 0 };
    for (const id of this.schoolIds) {
      try { const r = await new OverdueReminders(systemCtx(id, ["library"])).run(this.today); out.reminded += r.reminded; }
      catch (err) { out.failed++; console.error(JSON.stringify({ level: "error", msg: "library reminders failed", schoolId: id, err: String(err) })); }
    }
    if (out.failed) throw new Error(`Library reminders failed for ${out.failed} of ${out.schools} schools`);
    return out;
  }
}
