import { z } from "zod";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { ConflictError, NotFoundError, listQuerySchema, toPage, type ListQuery, type Page } from "@smw/feature-kit";
import { inWords, rupees } from "@smw/feature-kit/money";
import { schools, withConsole, type Tx } from "@smw/db";
import type { DocumentData } from "@smw/ui/finance/document-types";
import { finApprovals, finCashAccounts } from "@smw/feature-finance/schema";
import { PdfBuilder } from "@smw/integrations";
import { LookupService } from "./lookups";
import { ExpenseService, cashFor, checkAccount, checkCentre, journalIdOf, journalIdSql, need, onlyId } from "./base";
import { day, method, note, optionalId, paiseAmount } from "./inputs";
import { expIncome } from "./schema";

export type Income = typeof expIncome.$inferSelect;
const recordInput = z.object({
  date: day.optional(), fromName: z.string().trim().min(2, "Who paid?").max(120), accountId: z.uuid("Choose the income account."), costCentreId: optionalId,
  label: z.string().trim().min(2, "Say what it was for.").max(160), amountPaise: paiseAmount, method, cashAccountId: optionalId, reference: note(120),
});
const token = () => crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);

/** Undo an income receipt (after approval). Shared by the approval handler. */
export async function reverseIncome(tx: Tx, reverse: (key: string, memo: string) => Promise<unknown>, id: string, reason: string) {
  const [r] = await tx.select().from(expIncome).where(eq(expIncome.id, id)).for("update");
  if (!r) throw new NotFoundError("Receipt");
  if (r.status === "reversed") throw new ConflictError("This receipt is already reversed.");
  await reverse(`expenses:income:${id}`, `Undo of ${r.number}: ${reason}`);
  await tx.update(expIncome).set({ status: "reversed", reverseReason: reason }).where(eq(expIncome.id, id));
}

/** Money in that is not fees. Each gets a receipt number from the `other_receipt` series. */
export class IncomeService extends ExpenseService {
  async record(input: unknown): Promise<Income> {
    this.authorize("manage", "write");
    const d = this.parse(recordInput, input);
    return this.write("manage", async (tx) => {
      const date = await this.moneyDate(tx, d.date);
      await checkAccount(tx, d.accountId, "income"); await checkCentre(tx, d.costCentreId);
      const cash = await cashFor(tx, this.ctx.schoolId, d.method, d.cashAccountId);
      const number = await this.number(tx, "other_receipt", date);
      const [r] = await tx.insert(expIncome).values({ schoolId: this.ctx.schoolId, number, date, fromName: d.fromName, accountId: d.accountId, costCentreId: d.costCentreId ?? null, label: d.label, amountPaise: d.amountPaise, method: d.method, cashAccountId: cash.id, reference: d.reference ?? null, verifyToken: token(), createdBy: this.ctx.userId }).returning();
      await this.post(tx, { date, sourceKey: `expenses:income:${r!.id}`, sourceType: "exp_income", sourceId: r!.id, memo: `${r!.number}: ${d.label}`, lines: [{ account: { id: cash.accountId }, debit: d.amountPaise, memo: d.fromName }, { account: { id: d.accountId }, credit: d.amountPaise, costCentreId: d.costCentreId, memo: d.label }] });
      return r!;
    }, (r) => ({ action: "record", entity: "Other receipt", entityId: r.id, summary: `Receipt ${r.number}: ${rupees(r.amountPaise)} from ${r.fromName}` }));
  }

  async list(query: ListQuery = {}): Promise<Page<Income & { journalId: string | null; reversalPending: boolean }>> {
    const q = listQuerySchema.parse(query), f = q.filters;
    const where = and(
      onlyId(expIncome.id, f.id),
      q.q ? or(ilike(expIncome.number, `%${q.q}%`), ilike(expIncome.fromName, `%${q.q}%`), ilike(expIncome.label, `%${q.q}%`)) : undefined,
      f.status ? eq(expIncome.status, f.status as Income["status"]) : undefined, f.accountId ? eq(expIncome.accountId, f.accountId) : undefined,
      f.from ? sql`${expIncome.date} >= ${f.from}` : undefined, f.to ? sql`${expIncome.date} <= ${f.to}` : undefined,
    );
    return this.read("read", async (tx) => {
      const [rows, [n]] = await Promise.all([
        tx.select({ r: expIncome, journalId: journalIdSql("expenses:income:", expIncome.id), pending: sql<boolean>`exists (select 1 from fin_approvals a where a.ref_id = ${expIncome.id} and a.kind = 'expenses.reversal' and a.status = 'pending')` })
          .from(expIncome).where(where).orderBy(desc(expIncome.date), desc(expIncome.number)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(expIncome).where(where),
      ]);
      return toPage(rows.map(({ r, journalId, pending }) => ({ ...r, journalId, reversalPending: pending })), Number(n?.n ?? 0), q);
    });
  }

  async get(id: string) {
    return this.read("read", async (tx) => {
      if (!z.uuid().safeParse(id).success) throw new NotFoundError("Receipt");
      const r = need((await tx.select().from(expIncome).where(eq(expIncome.id, id)).limit(1))[0], "Receipt");
      const [cash] = r.cashAccountId ? await tx.select({ name: finCashAccounts.name }).from(finCashAccounts).where(eq(finCashAccounts.id, r.cashAccountId)) : [];
      const [ap] = await tx.select().from(finApprovals).where(and(eq(finApprovals.kind, "expenses.reversal"), eq(finApprovals.refId, id))).orderBy(desc(finApprovals.createdAt)).limit(1);
      return { receipt: r, cashName: cash?.name ?? null, journalId: await journalIdOf(tx, `expenses:income:${id}`), reversal: ap ? { id: ap.id, status: ap.status, reason: ap.reason, note: ap.note } : null };
    });
  }

  /** The receipt as a PDF. */
  async pdf(id: string) {
    const { number, data } = await this.document(id), school = await new LookupService(this.ctx).schoolName();
    const pdf = await PdfBuilder.create({ unicode: true });
    await pdf.need([school, number, ...data.facts.flat(), ...data.rows.flatMap((r) => Object.values(r).map(String)), ...data.totals.flat().map(String), data.amountWords ?? "", "₹0123456789 Receipt REVERSED"]);
    pdf.header({ title: "Receipt", orgName: school, rightLines: [`No: ${number}`] });
    pdf.facts(data.facts);
    pdf.table({ columns: [{ label: "For", width: 330 }, { label: "Amount", width: 150, align: "right" }], rows: data.rows.map((r) => [String(r.item), String(r.amount)]) });
    pdf.totals(data.totals).text(data.amountWords ?? "", { size: 9 });
    for (const m of data.marks) pdf.text(m, { size: 14, bold: true, color: [0.7, 0.1, 0.1] });
    return { filename: `receipt-${number.replace(/\W+/g, "-")}.pdf`, bytes: await pdf.save() };
  }

  async requestReversal(id: string, reason: string) {
    const why = this.parse(z.string().trim().min(3, "Say why.").max(300), reason);
    return this.write("manage", async (tx) => {
      const [r] = await tx.select().from(expIncome).where(eq(expIncome.id, id)).for("update");
      if (!r) throw new NotFoundError("Receipt");
      if (r.status === "reversed") throw new ConflictError("This receipt is already reversed.");
      return this.askApproval(tx, { kind: "expenses.reversal", refType: "exp_income", refId: id, title: `Reverse receipt ${r.number}`, amountPaise: r.amountPaise, reason: why, href: `/app/expenses/income?q=${encodeURIComponent(r.number)}` });
    }, (a) => ({ action: "request-reversal", entity: "Other receipt", entityId: id, summary: `Asked to reverse: ${a.title}` }));
  }

  /** What the receipt says, in the shape the receipt template and its PDF read. */
  async document(id: string): Promise<{ number: string; data: DocumentData }> {
    const { receipt: r, cashName } = await this.get(id);
    return {
      number: r.number,
      data: {
        facts: [["Receipt no", r.number], ["Date", r.date], ["Received from", r.fromName], ["Paid by", `${r.method.replace(/_/g, " ")}${cashName ? ` to ${cashName}` : ""}`], ...(r.reference ? [["Reference", r.reference] as [string, string]] : [])],
        rows: [{ item: r.label, amount: rupees(r.amountPaise) }],
        totals: [["Total", rupees(r.amountPaise), true]], amountWords: inWords(r.amountPaise), notes: [], marks: r.status === "reversed" ? ["REVERSED"] : [], qrSvg: null,
      },
    };
  }
}

/** Public check of a receipt by its token (the QR on the page): only whether it is real, its number and amount. Nothing else leaks. */
export async function verifyIncomeReceipt(tokenValue: string) {
  if (!/^[a-f0-9]{40}$/.test(tokenValue)) return null;
  return withConsole(async (tx) => {
    const [r] = await tx.select({ number: expIncome.number, date: expIncome.date, amountPaise: expIncome.amountPaise, status: expIncome.status, school: schools.name })
      .from(expIncome).innerJoin(schools, eq(schools.id, expIncome.schoolId)).where(eq(expIncome.verifyToken, tokenValue)).limit(1);
    return r ?? null;
  });
}
