import { desc, eq, sql } from "drizzle-orm";
import { NotFoundError } from "@smw/feature-kit";
import { todayIST } from "@smw/feature-kit/money";
import { students } from "@smw/feature-students/schema";
import { FeesBase } from "./base";
import { promiseInput, stopInput } from "./inputs";
import { feePromises, feeReminderStops } from "./schema";

/** "I will pay by the 10th": reminders pause until then; a promise that passed with money still open is listed as broken. */
export class PromiseService extends FeesBase {
  async add(input: unknown) {
    this.authorize("collect", "write");
    const d = this.parse(promiseInput, input);
    return this.write("collect", async (tx) => {
      const [s] = await tx.select({ id: students.id }).from(students).where(eq(students.id, d.studentId));
      if (!s) throw new NotFoundError("Student");
      const [row] = await tx.insert(feePromises).values({ schoolId: this.ctx.schoolId, studentId: d.studentId, promisedOn: d.promisedOn, amountPaise: d.amountPaise ?? null, note: d.note ?? null, createdBy: this.ctx.userId }).returning();
      return row!;
    }, (p) => ({ action: "promise", entity: "Student", entityId: p.studentId, summary: `Promise to pay by ${p.promisedOn}` }));
  }

  forStudent(studentId: string) {
    return this.viewer(async (tx, own) => {
      this.assertVisible(own, studentId);
      return tx.select().from(feePromises).where(eq(feePromises.studentId, studentId)).orderBy(desc(feePromises.promisedOn));
    });
  }

  /** Promises whose day has passed while the student still owes something overdue. */
  async broken() {
    return this.read("read", async (tx) => {
      const today = todayIST();
      return (await tx.execute<{ student_id: string; name: string; promised_on: string; amount_paise: number | null; note: string | null }>(sql`
        select p.student_id, s.name, p.promised_on, p.amount_paise, p.note from fee_promises p join students s on s.id = p.student_id
        where p.promised_on < ${today} and p.promised_on = (select max(promised_on) from fee_promises q where q.student_id = p.student_id)
          and exists (select 1 from fee_invoices i where i.student_id = p.student_id and i.status = 'issued' and i.due_date < ${today} and i.gross_paise - i.concession_paise - i.credited_paise + i.late_paise - i.paid_paise > 0)
        order by p.promised_on`)).map((r) => ({ studentId: r.student_id, name: r.name, promisedOn: r.promised_on, amountPaise: r.amount_paise === null ? null : Number(r.amount_paise), note: r.note }));
    });
  }

  /** Stop reminders for one student (a family in talks with the office). */
  async stopReminders(input: unknown) {
    this.authorize("collect", "write");
    const d = this.parse(stopInput, input);
    return this.write("collect", async (tx) => {
      const [s] = await tx.select({ id: students.id }).from(students).where(eq(students.id, d.studentId));
      if (!s) throw new NotFoundError("Student");
      await tx.insert(feeReminderStops).values({ schoolId: this.ctx.schoolId, studentId: d.studentId, reason: d.reason }).onConflictDoUpdate({ target: [feeReminderStops.schoolId, feeReminderStops.studentId], set: { reason: d.reason } });
      return { studentId: d.studentId };
    }, (r) => ({ action: "stop_reminders", entity: "Student", entityId: r.studentId, summary: `Stopped fee reminders: ${d.reason}` }));
  }

  async resumeReminders(studentId: string) {
    return this.write("collect", async (tx) => { await tx.delete(feeReminderStops).where(eq(feeReminderStops.studentId, studentId)); return { studentId }; },
      (r) => ({ action: "resume_reminders", entity: "Student", entityId: r.studentId, summary: "Resumed fee reminders" }));
  }
}
