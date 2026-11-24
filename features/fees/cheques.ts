import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, NotFoundError, ValidationError, listQuerySchema, toPage, type ListQuery } from "@smw/feature-kit";
import { rupees } from "@smw/feature-kit/money";
import { cashAccount } from "@smw/feature-finance/posting";
import { finCashAccounts } from "@smw/feature-finance/schema";
import { FeesBase } from "./base";
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
      await tx.update(feeReceipts).set({ status: "valid" }).where(eq(feeReceipts.id, c.receiptId));
      await this.post(tx, { date, sourceKey: `fees:cheque-clear:${c.id}`, sourceType: "fee_cheque", sourceId: c.id, memo: `Cheque ${c.chequeNo} cleared`, lines: [{ account: { id: acct!.accountId }, debit: c.amountPaise }, { account: "cheques", credit: c.amountPaise }] });
    });
  }

  /** Bounced: the receipt is taken back, the bills reopen, and the school's bounce charge is billed once. */
  bounce(input: unknown) {
    return this.step(input, ["received", "deposited"], "bounced", async (tx, c, d, date) => {
      if (!d.reason) throw new ValidationError({ reason: "Say why it bounced, like insufficient funds." });
      const [r] = await tx.select().from(feeReceipts).where(eq(feeReceipts.id, c.receiptId)).for("update");
      if (r!.advancePaise > 0 && (await this.advanceOf(tx, r!.studentId)) < r!.advancePaise) {
        throw new ConflictError(`The ${rupees(r!.advancePaise)} advance from this cheque has already been used on other bills. Reverse or refund what used it first.`);
      }
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
