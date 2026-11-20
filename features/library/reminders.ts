import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { schoolUrl } from "@smw/config";
import { schools, users } from "@smw/db";
import { SchoolService, systemCtx, type Ctx } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { emailHtml, services } from "@smw/integrations";
import { students } from "@smw/feature-students/schema";
import libraryFeature from "./feature";
import { REMINDER_EVERY_DAYS, addDays, daysLate, todayIST } from "./rules";
import { bookCopies, books, loans } from "./schema";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One school's overdue reminders: a notice and an email to the borrower's login, at most once a week per loan. */
export class OverdueReminders extends SchoolService<"read" | "manage" | "self"> {
  protected feature = libraryFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** Returns how many loans were reminded. Idempotent within a day: claiming a loan (stamping `last_reminder_on`) and its notice commit together. */
  async run(today = todayIST()): Promise<{ reminded: number; emails: number }> {
    const mails: { to: string; name: string; subject: string; text: string; html: string }[] = [];
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
        return userId ? [{ userId, title, days: daysLate(c.dueOn, today), dueOn: c.dueOn }] : [];
      });
      await NotificationWriter.insert(tx, this.ctx.schoolId, targets.map((t) => ({
        userId: t.userId, kind: "system" as const, title: `Library book overdue: ${t.title}`, body: `It was due on ${t.dueOn} and is ${t.days} ${t.days === 1 ? "day" : "days"} late. Please return it to the library.`, href: "/app/library",
      })));
      const people = await tx.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, targets.map((t) => t.userId)));
      const [school] = await tx.select({ name: schools.name, slug: schools.slug }).from(schools).limit(1);
      for (const t of targets) {
        const p = people.find((u) => u.id === t.userId);
        if (!p?.email) continue;
        const link = schoolUrl(school?.slug ?? "", "/app/library");
        mails.push({
          to: p.email, name: p.name, subject: `Library book overdue: ${t.title}`,
          text: `Hi ${p.name},\n\n${t.title} was due on ${t.dueOn} and is ${t.days} days late. Please return it to the library.\n\n${link}\n`,
          html: emailHtml("A library book is overdue", `<p>Hi ${esc(p.name)},</p><p><strong>${esc(t.title)}</strong> was due on ${esc(t.dueOn)} and is ${t.days} ${t.days === 1 ? "day" : "days"} late. Please return it to the library.</p>`, { label: "Open the library", url: link }),
        });
      }
      return targets.length;
    }, (n) => ({ action: "overdue_reminders", entity: "Loan", summary: `Sent ${n} overdue ${n === 1 ? "reminder" : "reminders"}` }));

    // Never await mail inside the transaction; one bad address must not stop the rest.
    let emails = 0;
    for (const m of mails) {
      try { await services().email.send({ to: m.to, subject: m.subject, text: m.text, html: m.html }); emails++; }
      catch (err) { console.error(JSON.stringify({ level: "error", msg: "library reminder email failed", schoolId: this.ctx.schoolId, err: String(err) })); }
    }
    return { reminded, emails };
  }
}

/** The worker job "library.overdue-reminders": every given school, once. One school failing does not stop the rest; the run fails at the end so the queue retries (safe: a loan is reminded once a week). */
export class OverdueReminderJob {
  constructor(private readonly schoolIds: string[], private readonly today = todayIST()) {}

  async run(): Promise<{ schools: number; reminded: number; emails: number; failed: number }> {
    const out = { schools: this.schoolIds.length, reminded: 0, emails: 0, failed: 0 };
    for (const id of this.schoolIds) {
      try { const r = await new OverdueReminders(systemCtx(id, ["library"])).run(this.today); out.reminded += r.reminded; out.emails += r.emails; }
      catch (err) { out.failed++; console.error(JSON.stringify({ level: "error", msg: "library reminders failed", schoolId: id, err: String(err) })); }
    }
    if (out.failed) throw new Error(`Library reminders failed for ${out.failed} of ${out.schools} schools`);
    return out;
  }
}
