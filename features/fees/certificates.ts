import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { fyOf, fyRange, todayIST } from "@smw/feature-kit/money";
import { FeesBase, calcOf } from "./base";
import { invoiceLateFee, openOf } from "./calc";
import { feeAllocations, feeHeads, feeInvoiceLines, feeInvoices, feeReceipts } from "./schema";

/** The data behind the statement, the tuition certificate and the no-dues certificate. Layout and PDF come from the templates. */
export class CertificateService extends FeesBase {
  /** Statement of account: every ledger line on this student's dues, with the running balance. */
  async statement(studentId: string, o: { from?: string; to?: string } = {}) {
    return this.viewer(async (tx, own) => {
      this.assertVisible(own, studentId);
      const student = await this.oneStudent(tx, studentId);
      const rows = [...(await tx.execute<{ date: string; number: string; memo: string; debit: string; credit: string; source_type: string; source_id: string | null; journal_id: string }>(sql`
        select j.date::text as date, j.number, coalesce(jl.memo, j.memo) memo, jl.debit_paise debit, jl.credit_paise credit, j.source_type, j.source_id, j.id journal_id
        from fin_journal_lines jl join fin_journals j on j.id = jl.journal_id join fin_accounts a on a.id = jl.account_id
        where a.system_key = 'student_dues' and jl.party_type = 'student' and jl.party_id = ${studentId}::uuid order by j.date, j.created_at, jl.created_at, jl.id`))];
      let balance = 0;
      const all = rows.map((r) => { balance += Number(r.debit) - Number(r.credit); return { date: r.date, number: r.number, memo: r.memo, debitPaise: Number(r.debit), creditPaise: Number(r.credit), balancePaise: balance, sourceType: r.source_type, sourceId: r.source_id, journalId: r.journal_id }; });
      const shown = all.filter((r) => (!o.from || r.date >= o.from) && (!o.to || r.date <= o.to));
      const opening = o.from ? all.filter((r) => r.date < o.from!).at(-1)?.balancePaise ?? 0 : 0;
      return { student, openingPaise: opening, rows: shown, closingPaise: balance };
    });
  }

  /** Tuition fee received in a financial year ("2026-27"): only heads counted as tuition, only live receipts. */
  async tuition(studentId: string, fy = fyOf(todayIST())) {
    return this.viewer(async (tx, own) => {
      this.assertVisible(own, studentId);
      const [from, to] = fyRange(fy);
      const student = await this.oneStudent(tx, studentId);
      const rows = await tx.select({ number: feeReceipts.number, date: feeReceipts.date, head: feeHeads.name, amountPaise: feeAllocations.amountPaise })
        .from(feeAllocations).innerJoin(feeReceipts, eq(feeReceipts.id, feeAllocations.receiptId)).innerJoin(feeInvoiceLines, eq(feeInvoiceLines.id, feeAllocations.invoiceLineId)).innerJoin(feeHeads, eq(feeHeads.id, feeInvoiceLines.headId))
        .where(and(eq(feeAllocations.studentId, studentId), isNull(feeAllocations.undoneAt), inArray(feeReceipts.status, ["valid", "clearing"]), eq(feeHeads.isTuition, true), sql`${feeReceipts.date} between ${from}::date and ${to}::date`)).orderBy(asc(feeReceipts.date), asc(feeReceipts.number));
      return { student, fy, from, to, rows, totalPaise: rows.reduce((s, r) => s + r.amountPaise, 0) };
    });
  }

  /** No dues: nothing open, counting the late fee that has built up. Lists what blocks it. */
  async noDues(studentId: string) {
    return this.viewer(async (tx, own) => {
      this.assertVisible(own, studentId);
      const today = todayIST();
      const student = await this.oneStudent(tx, studentId);
      const bills = (await this.loadInvoices(tx, and(eq(feeInvoices.studentId, studentId), eq(feeInvoices.status, "issued")))).map((i) => ({ id: i.id, number: i.number, label: i.label, openPaise: openOf(i), accruedLatePaise: invoiceLateFee(i.lateRule, calcOf(i), today) })).filter((b) => b.openPaise + b.accruedLatePaise > 0);
      const owedPaise = bills.reduce((s, b) => s + b.openPaise + b.accruedLatePaise, 0);
      return { student, date: today, clear: owedPaise === 0, owedPaise, bills };
    });
  }
}
