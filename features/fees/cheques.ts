import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { PdfBuilder } from "@smw/integrations";
import { schools } from "@smw/db";
import type { Tx } from "@smw/db";
import { ConflictError, NotFoundError, listQuerySchema, toPage, type ListQuery } from "@smw/feature-kit";
import { rupees, todayIST } from "@smw/feature-kit/money";
import { cashAccount } from "@smw/feature-finance/posting";
import { finCashAccounts } from "@smw/feature-finance/schema";
import { FeesBase, invalid } from "./base";
import { chequeStepInput } from "./inputs";
import { InvoiceService } from "./invoices";
import { ReceiptService } from "./receipts";
import { feeAllocations, feeCheques, feeReceipts } from "./schema";

type Cheque = typeof feeCheques.$inferSelect;
type Step = ReturnType<typeof chequeStepInput.parse>;

/** The cheque register: received, deposited, then cleared or bounced. A bounce takes the receipt back and bills the bounce charge once. */
export class ChequeService extends FeesBase {
  async list(query: ListQuery = {}) {
    const q = listQuerySchema.parse(query);
    return this.read("collect", async (tx) => {
      const where = q.filters.status ? eq(feeCheques.status, q.filters.status as Cheque["status"]) : undefined;
      const [rows, [n]] = await Promise.all([
        tx.select({ cheque: feeCheques, receiptNumber: feeReceipts.number, studentId: feeReceipts.studentId, studentName: sql<string>`${feeReceipts.snapshot}->>'studentName'`, receiptDate: feeReceipts.date })
          .from(feeCheques).innerJoin(feeReceipts, eq(feeReceipts.id, feeCheques.receiptId)).where(where).orderBy(desc(feeCheques.chequeDate)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(feeCheques).where(where),
      ]);
      return toPage(rows, Number(n?.n ?? 0), q);
    });
  }

  /** Count and total per state, over every cheque. */
  async totals() {
    return this.read("collect", async (tx) => {
      const rows = await tx.select({ status: feeCheques.status, n: sql<number>`count(*)::int`, v: sql<string>`coalesce(sum(${feeCheques.amountPaise}), 0)` }).from(feeCheques).groupBy(feeCheques.status);
      return Object.fromEntries(rows.map((r) => [r.status, { count: r.n, paise: Number(r.v) }])) as Record<string, { count: number; paise: number }>;
    });
  }

  /** The four columns of the cheque board (post-dated ones sit in "received" until their date), with the totals. */
  async board() {
    const of = (status: string) => this.list({ filters: { status }, pageSize: 100 });
    const [received, deposited, cleared, bounced, totals] = await Promise.all([of("received"), of("deposited"), of("cleared"), of("bounced"), this.totals()]);
    return { received, deposited, cleared, bounced, totals };
  }

  /** A bank slip listing the chosen cheques. It marks nothing: depositing is a separate step per cheque. */
  async slipFile(ids: string[]): Promise<{ filename: string; bytes: Uint8Array }> {
    const NIL = "00000000-0000-0000-0000-000000000000";
    const rows = await this.read("collect", async (tx) => {
      const [list, [school]] = await Promise.all([
        tx.select({ c: feeCheques, student: sql<string>`${feeReceipts.snapshot}->>'studentName'` }).from(feeCheques).innerJoin(feeReceipts, eq(feeReceipts.id, feeCheques.receiptId)).where(inArray(feeCheques.id, ids.length ? ids : [NIL])).orderBy(asc(feeCheques.chequeDate)),
        tx.select({ name: schools.name }).from(schools).limit(1),
      ]);
      return { list, school };
    });
    if (!rows.list.length) throw new NotFoundError("Cheque");
    const pdf = await PdfBuilder.create();
    pdf.header({ title: "CHEQUE DEPOSIT SLIP", orgName: rows.school?.name ?? "School", rightLines: [`Date: ${todayIST()}`, `Cheques: ${rows.list.length}`] });
    const money = PdfBuilder.money;
    pdf.table({ columns: [{ label: "Cheque no", width: 80 }, { label: "Bank", width: 110 }, { label: "Cheque date", width: 70 }, { label: "Student", width: 120 }, { label: "Amount", width: 69, align: "right" }], rows: rows.list.map((r) => [r.c.chequeNo, r.c.bank, r.c.chequeDate, r.student ?? "", money(r.c.amountPaise)]) });
    pdf.totals([["Total", money(rows.list.reduce((s, r) => s + r.c.amountPaise, 0)), true]]);
    pdf.space(40).text("Deposited by: ____________________    Bank seal and date", { size: 9 });
    return { filename: `cheque-deposit-${todayIST()}.pdf`, bytes: await pdf.save() };
  }

  /** Lock the students the receipt touched, then the cheque, check it is in a state this step allows, and run the step. */
  private step(input: unknown, from: Cheque["status"][], verb: string, run: (tx: Tx, c: Cheque, d: Step, date: string) => Promise<void>) {
    this.authorize("collect", "write");
    const d = this.parse(chequeStepInput, input);
    return this.write("collect", async (tx) => {
      const [pre] = await tx.select({ r: feeCheques.receiptId, s: feeReceipts.studentId }).from(feeCheques).innerJoin(feeReceipts, eq(feeReceipts.id, feeCheques.receiptId)).where(eq(feeCheques.id, d.id));
      if (!pre) throw new NotFoundError("Cheque");
      const hit = await tx.select({ s: feeAllocations.studentId }).from(feeAllocations).where(eq(feeAllocations.receiptId, pre.r));
      await this.lockStudents(tx, [pre.s, ...hit.map((h) => h.s)]);
      const [c] = await tx.select().from(feeCheques).where(eq(feeCheques.id, d.id)).for("update");
      if (!from.includes(c!.status)) throw new ConflictError(`This cheque is ${c!.status}, so it cannot be marked ${verb}.`);
      const [r] = await tx.select({ status: feeReceipts.status }).from(feeReceipts).where(eq(feeReceipts.id, c!.receiptId));
      if (r?.status !== "clearing") throw new ConflictError(`The receipt of this cheque is ${r?.status}, so the cheque cannot be marked ${verb}. Only a receipt that waits for the cheque can be moved on.`);
      await run(tx, c!, d, await this.moneyDate(tx, d.date));
      return c!.id;
    }, (id) => ({ action: verb, entity: "Cheque", entityId: id, summary: `Cheque ${verb}` }));
  }

  deposit(input: unknown) {
    return this.step(input, ["received"], "deposited", async (tx, c, d, date) => {
      const acct = await cashAccount(tx, this.ctx.schoolId, { id: d.cashAccountId, kind: "bank" });
      await tx.update(feeCheques).set({ status: "deposited", depositedTo: acct.id, depositedOn: date }).where(eq(feeCheques.id, c.id));
    });
  }

  /** Cleared: the money is in the bank. Dr Bank, Cr Cheques in hand. */
  clear(input: unknown) {
    return this.step(input, ["deposited"], "cleared", async (tx, c, _d, date) => {
      const [acct] = await tx.select().from(finCashAccounts).where(eq(finCashAccounts.id, c.depositedTo!));
      await tx.update(feeCheques).set({ status: "cleared", clearedOn: date }).where(eq(feeCheques.id, c.id));
      const [paid] = await tx.update(feeReceipts).set({ status: "valid" }).where(eq(feeReceipts.id, c.receiptId)).returning({ studentId: feeReceipts.studentId });
      // The advance of this cheque is the family's to use now.
      await this.autoUseAdvance(tx, [paid!.studentId], date);
      await this.post(tx, { date, sourceKey: `fees:cheque-clear:${c.id}`, sourceType: "fee_receipt", sourceId: c.receiptId, memo: `Cheque ${c.chequeNo} cleared`, lines: [{ account: { id: acct!.accountId }, debit: c.amountPaise }, { account: "cheques", credit: c.amountPaise }] });
    });
  }

  /** Bounced: the receipt is taken back, the bills reopen, and the school's bounce charge is billed once. */
  bounce(input: unknown) {
    return this.step(input, ["received", "deposited"], "bounced", async (tx, c, d, date) => {
      if (!d.reason) throw invalid("reason", "Say why it bounced, like insufficient funds.");
      const [r] = await tx.select().from(feeReceipts).where(eq(feeReceipts.id, c.receiptId)).for("update");
      await new ReceiptService(this.ctx).takeBack(tx, r!, date, `Cheque ${c.chequeNo} bounced: ${d.reason}`);
      await tx.update(feeCheques).set({ status: "bounced", bouncedOn: date, bounceReason: d.reason }).where(eq(feeCheques.id, c.id));
      await tx.update(feeReceipts).set({ status: "bounced" }).where(eq(feeReceipts.id, r!.id));
      const { bounceChargePaise } = await this.settings(tx);
      if (bounceChargePaise > 0) {
        const bills = new InvoiceService(this.ctx);
        const year = await this.currentYear(tx);
        const id = await bills.createDraft(tx, { studentId: r!.studentId, yearId: year.id, kind: "bounce", label: `Bounced cheque ${c.chequeNo}`, dueDate: date, sourceKey: `bounce:${c.id}`, lines: [{ kind: "bounce", label: "Bounced cheque charge", amountPaise: bounceChargePaise }] });
        await bills.issueIn(tx, [id], date);
      }
      await this.tell(tx, [r!.studentId], "Cheque bounced", `Cheque ${c.chequeNo} bounced${bounceChargePaise ? `. A charge of ${rupees(bounceChargePaise)} was added.` : "."} The dues are open again.`);
    });
  }
}
