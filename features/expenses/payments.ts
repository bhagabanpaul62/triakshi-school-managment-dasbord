import { z } from "zod";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError, listQuerySchema, toPage, type ListQuery, type Page } from "@smw/feature-kit";
import { apportion, rupees } from "@smw/feature-kit/money";
import { unseal } from "@smw/feature-kit/secret";
import type { Tx } from "@smw/db";
import { balanceOf, postJournal, reverseJournal, type PostLine, type Poster } from "@smw/feature-finance/posting";
import { finApprovals, finCashAccounts } from "@smw/feature-finance/schema";
import { CASH_NOTE_PAISE } from "./constants";
import { ExpenseService, cashFor, journalIdOf, journalIdSql, need } from "./base";
import { netOf, openOf } from "./bills";
import { day, method, note, paiseAmount } from "./inputs";
import { expBillLines, expBills, expPaymentBills, expPayments, expVendors } from "./schema";

export type Payment = typeof expPayments.$inferSelect;

export const payInput = z.object({
  vendorId: z.uuid("Choose a vendor."),
  date: day.optional(),
  method,
  cashAccountId: z.preprocess((v) => (v === "" ? undefined : v), z.uuid().optional()),
  /** UTR, cheque number, or the note that cash above the limit needs. */
  reference: note(120),
  allocations: z.preprocess((v) => (typeof v === "string" ? JSON.parse(v) : v), z.array(z.object({ billId: z.uuid(), amountPaise: paiseAmount })).min(1, "Choose at least one bill.").max(100)),
});

/** Cash basis: the expense is recognised in step with what is paid, so the parts add up to the bill's gross exactly. */
const recognised = (gross: number, net: number, paid: number) => (paid >= net ? gross : Math.round((gross * paid) / net));

export async function postPayment(tx: Tx, by: Poster, p: Payment, allocs: { bill: typeof expBills.$inferSelect; amountPaise: number }[], cashLedgerId: string, basis: "accrual" | "cash") {
  const party = { type: "vendor" as const, id: p.vendorId };
  const lines: PostLine[] = [];
  if (basis === "accrual") lines.push({ account: "vendor_dues", debit: p.amountPaise, party });
  else {
    let tds = 0;
    for (const { bill, amountPaise } of allocs) {
      // shortcut: parts are cut on the bill's original lines, so one line can differ by a paisa from its bill on many small part payments; the totals are exact.
      const share = recognised(bill.grossPaise, netOf(bill), bill.paidPaise + amountPaise) - recognised(bill.grossPaise, netOf(bill), bill.paidPaise);
      const bl = await tx.select().from(expBillLines).where(eq(expBillLines.billId, bill.id)).orderBy(asc(expBillLines.sort));
      apportion(share, bl.map((l) => l.amountPaise)).forEach((v, i) => lines.push({ account: { id: bl[i]!.accountId }, debit: v, costCentreId: bl[i]!.costCentreId, memo: bill.billNo }));
      tds += share - amountPaise;
    }
    lines.push({ account: "tds_payable", credit: tds, party });
  }
  lines.push({ account: { id: cashLedgerId }, credit: p.amountPaise });
  return postJournal(tx, by, { date: p.date, sourceKey: `expenses:payment:${p.id}`, sourceType: "exp_payment", sourceId: p.id, memo: `Payment ${p.number}`, lines });
}

/** Undo a payment (after approval): mirror entry, bills owe again. Shared by the approval handler. */
export async function reversePayment(tx: Tx, by: Poster, id: string, memo: string, reason: string, today: string) {
  const [p] = await tx.select().from(expPayments).where(eq(expPayments.id, id)).for("update");
  if (!p) throw new NotFoundError("Payment");
  if (p.status === "reversed") throw new ConflictError("This payment is already reversed.");
  const parts = await tx.select().from(expPaymentBills).where(eq(expPaymentBills.paymentId, id)).orderBy(asc(expPaymentBills.billId));
  for (const x of parts) {
    const [b] = await tx.select().from(expBills).where(eq(expBills.id, x.billId)).for("update");
    await tx.update(expBills).set({ paidPaise: b!.paidPaise - x.amountPaise }).where(eq(expBills.id, x.billId));
  }
  await reverseJournal(tx, by, `expenses:payment:${id}`, { date: today, memo });
  await tx.update(expPayments).set({ status: "reversed", reverseReason: reason }).where(eq(expPayments.id, id));
  return p;
}

export class PaymentService extends ExpenseService {
  /** Warnings only: nothing here refuses. Shown on the form before saving, and again in the result. */
  async warnings(tx: Tx, i: { vendorId: string; date: string; method: string; amountPaise: number; cashLedgerId: string }) {
    const out: string[] = [];
    if (i.method === "cash") {
      const [r] = await tx.select({ v: sql<string>`coalesce(sum(${expPayments.amountPaise}), 0)` }).from(expPayments).where(and(eq(expPayments.vendorId, i.vendorId), eq(expPayments.date, i.date), eq(expPayments.method, "cash"), eq(expPayments.status, "valid")));
      if (Number(r?.v ?? 0) + i.amountPaise > CASH_NOTE_PAISE) out.push(`Cash above ${rupees(CASH_NOTE_PAISE)} to one vendor in a day is not allowed as a business expense for tax. Write a note.`);
    }
    if ((await balanceOf(tx, [i.cashLedgerId])) < i.amountPaise) out.push("This cash or bank account holds less than this payment. Check the balance in Finance.");
    return out;
  }

  /** Which warnings would this payment get? For the form's live panel. */
  async preview(input: unknown) {
    const d = this.parse(payInput, input);
    return this.read("manage", async (tx) => {
      const total = d.allocations.reduce((s, a) => s + a.amountPaise, 0);
      const cash = await cashFor(tx, this.ctx.schoolId, d.method, d.cashAccountId);
      return { totalPaise: total, from: cash.name, warnings: await this.warnings(tx, { vendorId: d.vendorId, date: d.date ?? (await this.moneyDate(tx, undefined)), method: d.method, amountPaise: total, cashLedgerId: cash.accountId }) };
    });
  }

  async pay(input: unknown): Promise<{ payment: Payment; warnings: string[]; journalId: string | null }> {
    this.authorize("manage", "write");
    const d = this.parse(payInput, input);
    return this.write("manage", async (tx) => {
      const date = await this.moneyDate(tx, d.date);
      const [vendor] = await tx.select().from(expVendors).where(eq(expVendors.id, d.vendorId)).limit(1);
      if (!vendor) throw new ValidationError({ vendorId: "Choose a vendor from the list." });
      if (d.method === "bank_transfer" && !(vendor.bankLast4 && vendor.ifsc)) throw new ConflictError(`${vendor.name} has no bank account and IFSC saved. Add them on the vendor page, or pay another way.`);
      const merged = new Map<string, number>();
      for (const a of d.allocations) merged.set(a.billId, (merged.get(a.billId) ?? 0) + a.amountPaise);
      const bills = await tx.select().from(expBills).where(inArray(expBills.id, [...merged.keys()])).orderBy(asc(expBills.id)).for("update");
      if (bills.length !== merged.size) throw new ValidationError({ allocations: "One of these bills was not found." });
      const allocs = bills.map((bill) => ({ bill, amountPaise: merged.get(bill.id)! }));
      for (const { bill, amountPaise } of allocs) {
        if (bill.vendorId !== d.vendorId) throw new ValidationError({ allocations: `Bill ${bill.billNo} belongs to another vendor.` });
        if (bill.status !== "approved") throw new ConflictError(bill.status === "pending" ? `Bill ${bill.billNo} is waiting for approval. It can be paid once approved.` : `Bill ${bill.billNo} is ${bill.status} and cannot be paid.`);
        if (amountPaise > openOf(bill)) throw new ConflictError(openOf(bill) === 0 ? `Bill ${bill.billNo} is already paid.` : `Bill ${bill.billNo} has only ${rupees(openOf(bill))} left to pay.`);
      }
      const total = allocs.reduce((s, a) => s + a.amountPaise, 0);
      const cash = await cashFor(tx, this.ctx.schoolId, d.method, d.cashAccountId);
      const warnings = await this.warnings(tx, { vendorId: d.vendorId, date, method: d.method, amountPaise: total, cashLedgerId: cash.accountId });
      if (d.method === "cash" && warnings.some((w) => w.startsWith("Cash above")) && !d.reference) throw new ValidationError({ reference: "Cash above ₹10,000 to one vendor in a day needs a note here." });
      const settings = await this.settings(tx);
      const number = await this.number(tx, "voucher", date);
      const [payment] = await tx.insert(expPayments).values({ schoolId: this.ctx.schoolId, number, vendorId: d.vendorId, date, amountPaise: total, method: d.method, cashAccountId: cash.id, reference: d.reference ?? null, createdBy: this.ctx.userId }).returning();
      await tx.insert(expPaymentBills).values(allocs.map((a) => ({ schoolId: this.ctx.schoolId, paymentId: payment!.id, billId: a.bill.id, amountPaise: a.amountPaise })));
      await postPayment(tx, this.poster, payment!, allocs, cash.accountId, settings.basis);
      for (const a of allocs) await tx.update(expBills).set({ paidPaise: a.bill.paidPaise + a.amountPaise }).where(eq(expBills.id, a.bill.id));
      return { payment: payment!, warnings, journalId: await journalIdOf(tx, `expenses:payment:${payment!.id}`) };
    }, (r) => ({ action: "pay", entity: "Payment", entityId: r.payment.id, summary: `Paid ${rupees(r.payment.amountPaise)} to vendor, voucher ${r.payment.number}`, meta: { method: r.payment.method, warnings: r.warnings } }));
  }

  async list(query: ListQuery = {}): Promise<Page<Payment & { vendorName: string; billNos: string; journalId: string | null; reversalPending: boolean }>> {
    const q = listQuerySchema.parse(query), f = q.filters;
    const where = and(
      q.q ? or(ilike(expPayments.number, `%${q.q}%`), ilike(expVendors.name, `%${q.q}%`), ilike(expPayments.reference, `%${q.q}%`)) : undefined,
      f.vendorId ? eq(expPayments.vendorId, f.vendorId) : undefined, f.method ? eq(expPayments.method, f.method as Payment["method"]) : undefined,
      f.status ? eq(expPayments.status, f.status as Payment["status"]) : undefined,
      f.from ? sql`${expPayments.date} >= ${f.from}` : undefined, f.to ? sql`${expPayments.date} <= ${f.to}` : undefined,
    );
    return this.read("read", async (tx) => {
      const [rows, [n]] = await Promise.all([
        tx.select({ p: expPayments, vendorName: expVendors.name, journalId: journalIdSql("expenses:payment:", expPayments.id),
          billNos: sql<string>`coalesce((select string_agg(b.bill_no, ', ') from exp_payment_bills pb join exp_bills b on b.id = pb.bill_id where pb.payment_id = ${expPayments.id}), '')`,
          pending: sql<boolean>`exists (select 1 from fin_approvals a where a.ref_id = ${expPayments.id} and a.kind = 'expenses.reversal' and a.status = 'pending')` })
          .from(expPayments).innerJoin(expVendors, eq(expVendors.id, expPayments.vendorId)).where(where).orderBy(desc(expPayments.date), desc(expPayments.number)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(expPayments).innerJoin(expVendors, eq(expVendors.id, expPayments.vendorId)).where(where),
      ]);
      return toPage(rows.map(({ p, vendorName, journalId, billNos, pending }) => ({ ...p, vendorName, journalId, billNos, reversalPending: pending })), Number(n?.n ?? 0), q);
    });
  }

  async get(id: string) {
    return this.read("read", async (tx) => {
      if (!z.uuid().safeParse(id).success) throw new NotFoundError("Payment");
      const p = need((await tx.select().from(expPayments).where(eq(expPayments.id, id)).limit(1))[0], "Payment");
      const [vendor] = await tx.select().from(expVendors).where(eq(expVendors.id, p.vendorId));
      const bills = await tx.select({ id: expBills.id, billNo: expBills.billNo, amountPaise: expPaymentBills.amountPaise }).from(expPaymentBills).innerJoin(expBills, eq(expBills.id, expPaymentBills.billId)).where(eq(expPaymentBills.paymentId, id));
      const [cash] = p.cashAccountId ? await tx.select({ name: finCashAccounts.name }).from(finCashAccounts).where(eq(finCashAccounts.id, p.cashAccountId)) : [];
      const [ap] = await tx.select().from(finApprovals).where(and(eq(finApprovals.kind, "expenses.reversal"), eq(finApprovals.refId, id))).orderBy(desc(finApprovals.createdAt)).limit(1);
      return { payment: p, vendorName: vendor!.name, cashName: cash?.name ?? null, bills, journalId: await journalIdOf(tx, `expenses:payment:${id}`), reversal: ap ? { id: ap.id, status: ap.status, reason: ap.reason, note: ap.note } : null };
    });
  }

  /** Ask for a payment to be undone. It does nothing until another person approves. */
  async requestReversal(id: string, reason: string) {
    const why = this.parse(z.string().trim().min(3, "Say why.").max(300), reason);
    return this.write("manage", async (tx) => {
      const [p] = await tx.select().from(expPayments).where(eq(expPayments.id, id)).for("update");
      if (!p) throw new NotFoundError("Payment");
      if (p.status === "reversed") throw new ConflictError("This payment is already reversed.");
      return this.askApproval(tx, { kind: "expenses.reversal", refType: "exp_payment", refId: id, title: `Reverse payment ${p.number}`, amountPaise: p.amountPaise, reason: why, href: `/app/expenses/payments?q=${encodeURIComponent(p.number)}` });
    }, (a) => ({ action: "request-reversal", entity: "Payment", entityId: id, summary: `Asked to reverse payment: ${a.title}` }));
  }

  /** Bank file (CSV) of bank-transfer payments. Opens the sealed account numbers, so it is audited. */
  async bankFile(ids: string[]): Promise<string> {
    return this.write("manage", async (tx) => {
      const rows = await tx.select({ p: expPayments, v: expVendors }).from(expPayments).innerJoin(expVendors, eq(expVendors.id, expPayments.vendorId)).where(and(inArray(expPayments.id, ids), eq(expPayments.method, "bank_transfer"), eq(expPayments.status, "valid"))).orderBy(asc(expPayments.number));
      if (!rows.length) throw new ConflictError("None of the chosen payments is a valid bank transfer.");
      const bad = rows.filter(({ v }) => !v.bankSealed || !v.ifsc);
      if (bad.length) throw new ConflictError(`No bank account saved for ${[...new Set(bad.map(({ v }) => v.name))].join(", ")}. Add it on the vendor page.`);
      const head = ["Voucher", "Beneficiary", "Account number", "IFSC", "Amount (INR)", "Narration"];
      return [head, ...rows.map(({ p, v }) => [p.number, v.name, unseal(v.bankSealed!, this.ctx.schoolId), v.ifsc!, (p.amountPaise / 100).toFixed(2), `Voucher ${p.number}`])].map((r) => r.map(csvCell).join(",")).join("\r\n");
    }, () => ({ action: "bank-file", entity: "Payment", summary: `Made a bank file for ${ids.length} payment(s)` }));
  }

  /** What the voucher says, for the PDF and the screen. */
  async voucher(id: string) {
    const g = await this.get(id);
    return { number: g.payment.number, date: g.payment.date, vendorName: g.vendorName, method: g.payment.method, reference: g.payment.reference, from: g.cashName, amountPaise: g.payment.amountPaise, status: g.payment.status, bills: g.bills };
  }
}

/** A cell that a spreadsheet will not run as a formula. */
export const csvCell = (v: unknown) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
