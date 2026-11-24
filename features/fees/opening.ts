import { and, eq, inArray } from "drizzle-orm";
import { parseSheet, SheetError } from "@smw/integrations";
import { ValidationError } from "@smw/feature-kit";
import { students } from "@smw/feature-students/schema";
import { FeesBase } from "./base";
import type { InvoiceService } from "./invoices";
import { feeAdvances, feeInvoices } from "./schema";

const money = (v: string): number | null => {
  if (!v) return 0;
  const n = Number(v.replace(/[,\s₹]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

/**
 * Opening balances from a sheet (columns admission_no, dues, advance, deposit, as_of; rupees). Every row is checked
 * first; one bad row stops the whole import and nothing is written. Dues become one issued bill per student, advance
 * and deposit go on their lists, all posted against Opening balances.
 */
export class OpeningImport extends FeesBase {
  async run(file: { name: string; bytes: Uint8Array }, dryRun: boolean, invoices: InvoiceService) {
    let sheet;
    try { sheet = await parseSheet(file); } catch (e) { if (e instanceof SheetError) throw new ValidationError({ file: e.message }); throw e; }
    const missing = ["admission_no"].filter((c) => !sheet.columns.includes(c));
    if (missing.length) throw new ValidationError({ file: `The sheet needs a column called ${missing.join(", ")}. Download the template and use its first row.` });
    return this.write("setup", async (tx) => {
      const year = await this.currentYear(tx);
      const nos = sheet.rows.map((r) => r.admission_no);
      const found = await tx.select({ id: students.id, no: students.admissionNo }).from(students).where(inArray(students.admissionNo, nos));
      const byNo = new Map(found.map((s) => [s.no, s.id]));
      const done = new Set((await tx.select({ k: feeInvoices.sourceKey }).from(feeInvoices).where(and(eq(feeInvoices.kind, "opening"), eq(feeInvoices.status, "issued")))).map((r) => r.k));
      const errors: { line: number; message: string }[] = [];
      const rows: { studentId: string; dues: number; advance: number; deposit: number; asOf: string; no: string }[] = [];
      const seen = new Set<string>();
      sheet.rows.forEach((r, i) => {
        const line = sheet.lines[i]!;
        const err = (message: string) => errors.push({ line, message });
        const studentId = byNo.get(r.admission_no);
        const [dues, advance, deposit] = [money(r.dues ?? ""), money(r.advance ?? ""), money(r.deposit ?? "")];
        const asOf = r.as_of || year.startsOn;
        if (!studentId) return err(`No student with admission number ${r.admission_no || "(blank)"}.`);
        if (seen.has(studentId)) return err(`${r.admission_no} is on the sheet twice.`);
        seen.add(studentId);
        if (dues === null || advance === null || deposit === null) return err("Dues, advance and deposit must be amounts in rupees, like 12500 or 12,500.50.");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return err("as_of must be a date like 2026-04-01.");
        if (done.has(`opening:${studentId}`)) return err(`${r.admission_no} already has opening balances. They are not entered twice.`);
        if (dues + advance + deposit === 0) return err("This row has no amount.");
        rows.push({ studentId, dues, advance, deposit, asOf, no: r.admission_no });
      });
      const totals = { students: rows.length, duesPaise: rows.reduce((s, r) => s + r.dues, 0), advancePaise: rows.reduce((s, r) => s + r.advance, 0), depositPaise: rows.reduce((s, r) => s + r.deposit, 0) };
      if (dryRun || errors.length) return { applied: false, errors, totals };
      await this.lockStudents(tx, rows.map((r) => r.studentId));
      for (const r of rows) {
        if (r.dues > 0) {
          const id = await invoices.createDraft(tx, { studentId: r.studentId, yearId: year.id, kind: "opening", label: "Opening balance", dueDate: r.asOf, sourceKey: `opening:${r.studentId}`, lines: [{ kind: "opening", label: "Opening balance", amountPaise: r.dues }] });
          await invoices.issueIn(tx, [id], r.asOf);
        }
        for (const [kind, amount, account, label] of [["opening", r.advance, "student_advances", "Opening advance"], ["deposit", r.deposit, "deposits_payable", "Opening deposit"]] as const) {
          if (!amount) continue;
          const [row] = await tx.insert(feeAdvances).values({ schoolId: this.ctx.schoolId, studentId: r.studentId, kind, amountPaise: amount, note: label, date: r.asOf }).returning({ id: feeAdvances.id });
          await this.post(tx, { date: r.asOf, sourceKey: `fees:opening-${kind}:${row!.id}`, sourceType: "fee_advance", sourceId: row!.id, memo: `${label} (${r.no})`, lines: [{ account: "opening", debit: amount }, { account, credit: amount, party: { type: "student", id: r.studentId } }] });
        }
      }
      await this.audit(tx, { action: "import_opening", entity: "Fee opening balances", summary: `Imported opening balances for ${rows.length} students`, meta: totals });
      return { applied: true, errors, totals };
    });
  }
}
