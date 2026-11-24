import { and, desc, eq, inArray, sql, sum } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, NotFoundError } from "@smw/feature-kit";
import { rupees, todayIST } from "@smw/feature-kit/money";
import { cashAccount } from "@smw/feature-finance/posting";
import { finCashAccounts } from "@smw/feature-finance/schema";
import { FeesBase, invalid } from "./base";
import { closeCounterInput, openCounterInput } from "./inputs";
import { feeCounters, feeReceiptMethods, feeReceipts, feeRefunds } from "./schema";

type Counter = typeof feeCounters.$inferSelect;

/** One person's cash session: open with a float, take money, count, close with any difference explained. */
export class CounterService extends FeesBase {
  async open(input: unknown) {
    this.authorize("collect", "write");
    const d = this.parse(openCounterInput, input);
    return this.write("collect", async (tx) => {
      const mine = await tx.select().from(feeCounters).where(eq(feeCounters.userId, this.ctx.userId)).orderBy(desc(feeCounters.day));
      const open = mine.find((c) => !c.closedAt);
      if (open) throw new ConflictError(`You already have a counter open from ${open.day}. Close it first (Counter, Close).`);
      const today = todayIST();
      if (mine.some((c) => c.day === today)) throw new ConflictError("Your counter for today is closed, and a closed day takes no more money. Open a new one tomorrow, or ask an admin.");
      const acct = await cashAccount(tx, this.ctx.schoolId, { id: d.cashAccountId, kind: "cash" });
      const [row] = await tx.insert(feeCounters).values({ schoolId: this.ctx.schoolId, userId: this.ctx.userId, cashAccountId: acct.id, day: today, floatPaise: d.floatPaise }).returning();
      return row!;
    }, (c) => ({ action: "open", entity: "Counter", entityId: c.id, summary: `Opened the counter with a float of ${rupees(c.floatPaise)}` }));
  }

  /** What should be in the cash box: float + cash taken - cash refunded. Reversed and bounced receipts are not taken. */
  async expectedIn(tx: Tx, c: Counter): Promise<{ takenPaise: number; refundedPaise: number; expectedPaise: number }> {
    const [[taken], [refunded]] = await Promise.all([
      tx.select({ v: sum(feeReceiptMethods.amountPaise) }).from(feeReceiptMethods).innerJoin(feeReceipts, eq(feeReceipts.id, feeReceiptMethods.receiptId))
        .where(and(eq(feeReceipts.counterId, c.id), eq(feeReceiptMethods.method, "cash"), inArray(feeReceipts.status, ["valid", "clearing"]))),
      tx.select({ v: sum(feeRefunds.amountPaise) }).from(feeRefunds).where(and(eq(feeRefunds.method, "cash"), eq(feeRefunds.status, "approved"), eq(feeRefunds.paidOn, c.day), eq(feeRefunds.cashAccountId, c.cashAccountId))),
    ]);
    const [takenPaise, refundedPaise] = [Number(taken?.v ?? 0), Number(refunded?.v ?? 0)];
    return { takenPaise, refundedPaise, expectedPaise: c.floatPaise + takenPaise - refundedPaise };
  }

  /** The caller's open counter with live figures, or null. */
  async current() {
    return this.read("collect", async (tx) => {
      const [c] = await tx.select().from(feeCounters).where(and(eq(feeCounters.userId, this.ctx.userId), sql`${feeCounters.closedAt} is null`));
      if (!c) return null;
      const [figures, [n]] = await Promise.all([this.expectedIn(tx, c), tx.select({ n: sql<number>`count(*)::int` }).from(feeReceipts).where(eq(feeReceipts.counterId, c.id))]);
      return { counter: c, ...figures, receipts: Number(n?.n ?? 0) };
    });
  }

  /** Close the day. A difference needs a reason and is posted to Cash differences; the day then takes no more. */
  async close(input: unknown) {
    this.authorize("collect", "write");
    const d = this.parse(closeCounterInput, input);
    return this.write("collect", async (tx) => {
      const [c] = await tx.select().from(feeCounters).where(and(eq(feeCounters.userId, this.ctx.userId), sql`${feeCounters.closedAt} is null`)).for("update");
      if (!c) throw new NotFoundError("An open counter");
      const { expectedPaise } = await this.expectedIn(tx, c);
      if (d.denominations) {
        const sumNotes = Object.entries(d.denominations).reduce((s, [note, n]) => s + Number(note) * n, 0);
        if (sumNotes !== d.countedPaise) throw invalid("countedPaise", `The notes and coins add up to ${rupees(sumNotes)}, not ${rupees(d.countedPaise)}.`);
      }
      const diff = d.countedPaise - expectedPaise;
      if (diff !== 0 && !d.differenceReason) throw invalid("differenceReason", `The box should hold ${rupees(expectedPaise)} but you counted ${rupees(d.countedPaise)}. Say why it is ${diff < 0 ? "short" : "over"}.`);
      const [row] = await tx.update(feeCounters).set({ expectedPaise, countedPaise: d.countedPaise, denominations: d.denominations ?? null, differenceReason: d.differenceReason ?? null, closedAt: new Date() }).where(eq(feeCounters.id, c.id)).returning();
      if (diff !== 0) {
        const [cash] = await tx.select().from(finCashAccounts).where(eq(finCashAccounts.id, c.cashAccountId));
        const side = { account: { id: cash!.accountId } };
        await this.post(tx, { date: todayIST(), sourceKey: `fees:counter-diff:${c.id}`, sourceType: "fee_counter", sourceId: c.id, memo: `Counter difference: ${d.differenceReason}`,
          lines: diff < 0 ? [{ account: "cash_difference", debit: -diff }, { ...side, credit: -diff }] : [{ ...side, debit: diff }, { account: "cash_difference", credit: diff }] });
      }
      return { counter: row!, expectedPaise, differencePaise: diff };
    }, (r) => ({ action: "close", entity: "Counter", entityId: r.counter.id, summary: `Closed the counter: expected ${rupees(r.expectedPaise)}, counted ${rupees(r.counter.countedPaise ?? 0)}` }));
  }

  /** Past sessions, newest first. */
  async history(limit = 30) {
    return this.read("read", (tx) => tx.select().from(feeCounters).orderBy(desc(feeCounters.day)).limit(limit));
  }
}
