import { and, desc, eq, inArray, sql, sum } from "drizzle-orm";
import { PdfBuilder } from "@smw/integrations";
import { schools, users } from "@smw/db";
import type { Tx } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@smw/feature-kit";
import { rupees, todayIST } from "@smw/feature-kit/money";
import { NotificationWriter } from "@smw/feature-notifications/writer";
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

  /** What should be in the cash box: float + cash taken - cash this cashier refunded. Reversed and bounced receipts are not taken; a refund someone else paid out is not this box's. */
  async expectedIn(tx: Tx, c: Counter): Promise<{ takenPaise: number; refundedPaise: number; expectedPaise: number }> {
    const [[taken], [refunded]] = await Promise.all([
      tx.select({ v: sum(feeReceiptMethods.amountPaise) }).from(feeReceiptMethods).innerJoin(feeReceipts, eq(feeReceipts.id, feeReceiptMethods.receiptId))
        .where(and(eq(feeReceipts.counterId, c.id), eq(feeReceiptMethods.method, "cash"), inArray(feeReceipts.status, ["valid", "clearing"]))),
      tx.select({ v: sum(feeRefunds.amountPaise) }).from(feeRefunds).where(and(eq(feeRefunds.method, "cash"), eq(feeRefunds.status, "approved"), eq(feeRefunds.paidOn, c.day), eq(feeRefunds.cashAccountId, c.cashAccountId), eq(feeRefunds.createdBy, c.userId))),
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

  /**
   * Close the day. A difference needs a reason. Within the school's limit it is posted to Cash differences at once; above it
   * the session still closes with the counted cash, the difference waits as `pending` and approval
   * `fees.counter_difference` decides where it goes. Until then the cash account stays at what the box should hold.
   */
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
      // A counter that once had a difference never closes quietly: counting it again must not hide the first count.
      const before = c.firstCountedPaise !== null;
      const waits = before || (diff !== 0 && Math.abs(diff) > (await this.settings(tx)).counterDifferenceLimitPaise);
      const first = diff !== 0 && !before ? { firstExpectedPaise: expectedPaise, firstCountedPaise: d.countedPaise, firstReason: d.differenceReason ?? null } : {};
      const [row] = await tx.update(feeCounters).set({ expectedPaise, countedPaise: d.countedPaise, denominations: d.denominations ?? null, differenceReason: d.differenceReason ?? null, closedAt: new Date(), ...first, differenceState: diff === 0 && !before ? null : waits ? "pending" : "posted" }).where(eq(feeCounters.id, c.id)).returning();
      if (diff !== 0 && !waits) await this.postDifferenceIn(tx, row!, "difference");
      if (waits) {
        const ask = await this.askApproval(tx, this.differenceRequest(row!));
        await tx.update(feeCounters).set({ differenceApprovalId: ask.id }).where(eq(feeCounters.id, c.id));
        row!.differenceApprovalId = ask.id;
      }
      return { counter: row!, expectedPaise, differencePaise: diff };
    }, (r) => ({ action: "close", entity: "Counter", entityId: r.counter.id, summary: `Closed the counter: expected ${rupees(r.expectedPaise)}, counted ${rupees(r.counter.countedPaise ?? 0)}` }));
  }

  private differenceRequest(c: Counter) {
    const diff = (c.countedPaise ?? 0) - (c.expectedPaise ?? 0);
    const said = (d: number) => (d === 0 ? "matched" : `${rupees(Math.abs(d))} ${d < 0 ? "short" : "over"}`);
    const again = c.firstCountedPaise !== null && (c.firstCountedPaise !== c.countedPaise || c.firstExpectedPaise !== c.expectedPaise);
    const firstDiff = !again ? null : c.firstCountedPaise! - (c.firstExpectedPaise ?? 0);
    const both = firstDiff === null ? "" : ` First count: the box should hold ${rupees(c.firstExpectedPaise ?? 0)}, counted ${rupees(c.firstCountedPaise ?? 0)} (${said(firstDiff)}${c.firstReason ? `: ${c.firstReason}` : ""}). Counted again: should hold ${rupees(c.expectedPaise ?? 0)}, counted ${rupees(c.countedPaise ?? 0)} (${said(diff)}).`;
    return { kind: "fees.counter_difference", refType: "fee_counter", refId: c.id, title: `Counter of ${c.day} is ${firstDiff !== null ? `counted again, ${said(diff)}` : said(diff)}`, amountPaise: Math.abs(diff) || Math.abs(firstDiff ?? 0),
      reason: `${c.differenceReason ?? ""}${both}`.trim(), href: "/app/fees/counter" };
  }

  /** The one posting of a counter difference. Both outcomes share one source key, so the books can never hold two. */
  private async postDifferenceIn(tx: Tx, c: Counter, to: "difference" | "cashier") {
    const diff = (c.countedPaise ?? 0) - (c.expectedPaise ?? 0);
    const [cash] = await tx.select().from(finCashAccounts).where(eq(finCashAccounts.id, c.cashAccountId));
    const box = { account: { id: cash!.accountId } };
    const other = to === "cashier" ? { account: "cashier_dues" as const, party: { type: "staff" as const, id: c.userId } } : { account: "cash_difference" as const };
    await this.post(tx, { date: todayIST(), sourceKey: `fees:counter-diff:${c.id}`, sourceType: "fee_counter", sourceId: c.id, memo: to === "cashier" ? `Counter shortage kept with the cashier: ${c.differenceReason}` : `Counter difference: ${c.differenceReason}`,
      lines: diff < 0 ? [{ ...other, debit: -diff }, { ...box, credit: -diff }] : [{ ...box, debit: diff }, { ...other, credit: diff }] });
  }

  /**
   * The approval handler. Approved: the difference goes to Cash differences. Refused: a shortage stays with the cashier
   * (Cashier dues, in their name); extra cash stays unbooked until they count again.
   */
  async decideIn(tx: Tx, id: string, approved: boolean) {
    const [c] = await tx.select().from(feeCounters).where(eq(feeCounters.id, id)).for("update");
    if (!c) throw new NotFoundError("Counter");
    if (c.differenceState !== "pending") throw new ConflictError("This difference was already decided.");
    const short = (c.countedPaise ?? 0) < (c.expectedPaise ?? 0);
    const state = approved ? "posted" : short ? "cashier" : "recount";
    if ((approved || short) && c.countedPaise !== c.expectedPaise) await this.postDifferenceIn(tx, c, approved ? "difference" : "cashier");
    await tx.update(feeCounters).set({ differenceState: state }).where(eq(feeCounters.id, id));
    const body = approved ? `The difference of ${rupees(Math.abs((c.countedPaise ?? 0) - (c.expectedPaise ?? 0)))} on ${c.day} was approved and written to Cash differences.`
      : short ? `The shortage on ${c.day} was not approved. It now shows as owed by you (Cashier dues) until it is settled.` : `The extra cash on ${c.day} was not approved. Count again: ask your admin to reopen it, or send it for approval again.`;
    await NotificationWriter.insert(tx, this.ctx.schoolId, [{ userId: c.userId, topic: "work.decision" as const, subject: { type: "counter", id }, title: approved ? "Counter difference approved" : "Counter difference not approved", body, href: "/app/fees/counter" }]);
  }

  /** Take the request back. The difference stays unbooked; ask again or count again. */
  async withdraw(id: string) {
    this.authorize("collect", "write");
    return this.write("collect", async (tx) => {
      const c = await this.mineIn(tx, id, "pending");
      await this.withdrawRequest(tx, "fees.counter_difference", id);
      await this.withdrawIn(tx, id);
      return c;
    }, (c) => ({ action: "withdraw", entity: "Counter", entityId: c.id, summary: "Withdrew the counter difference request" }));
  }

  async withdrawIn(tx: Tx, id: string) { await tx.update(feeCounters).set({ differenceState: "recount" }).where(and(eq(feeCounters.id, id), eq(feeCounters.differenceState, "pending"))); }

  /** Ask for approval again after a refusal (extra cash) or a withdrawal. */
  async askAgain(id: string) {
    this.authorize("collect", "write");
    return this.write("collect", async (tx) => {
      const c = await this.mineIn(tx, id, "recount");
      const ask = await this.askApproval(tx, this.differenceRequest(c));
      const [row] = await tx.update(feeCounters).set({ differenceState: "pending", differenceApprovalId: ask.id }).where(eq(feeCounters.id, c.id)).returning();
      return row!;
    }, (c) => ({ action: "resubmit", entity: "Counter", entityId: c.id, summary: "Sent the counter difference for approval again" }));
  }

  /** Count again: the person's own session, same day only, and only while the difference has no decision. */
  async reopen(id: string) {
    this.authorize("collect", "write");
    return this.write("collect", async (tx) => {
      const c = await this.mineIn(tx, id, "recount");
      if (c.userId !== this.ctx.userId) throw new ForbiddenError("Only the cashier can reopen their own counter.");
      if (c.day !== todayIST()) throw new ConflictError("A counter can only be reopened on its own day. Send the difference for approval instead.");
      const [row] = await tx.update(feeCounters).set({ closedAt: null, expectedPaise: null, countedPaise: null, denominations: null, differenceReason: null, differenceState: null, differenceApprovalId: null }).where(eq(feeCounters.id, c.id)).returning();
      return row!;
    }, (c) => ({ action: "reopen", entity: "Counter", entityId: c.id, summary: "Reopened the counter to count again" }));
  }

  private async mineIn(tx: Tx, id: string, state: "pending" | "recount"): Promise<Counter> {
    const [c] = await tx.select().from(feeCounters).where(eq(feeCounters.id, id)).for("update");
    if (!c) throw new NotFoundError("Counter");
    if (c.userId !== this.ctx.userId && this.ctx.role !== "admin") throw new ForbiddenError("Only the cashier or an admin can do this.");
    if (c.differenceState !== state) throw new ConflictError(state === "pending" ? "This difference is not waiting for approval." : "This difference is not waiting for a recount or a new request.");
    return c;
  }

  /** Past sessions, newest first, with the cashier's name and what the count differed by. A cashier sees their own; staff who may read see all. */
  async history(limit = 30) {
    return this.read(this.can("collect") ? "collect" : "read", (tx) => tx.select({ c: feeCounters, name: users.name }).from(feeCounters).leftJoin(users, eq(users.id, feeCounters.userId))
      .where(this.can("read") ? undefined : eq(feeCounters.userId, this.ctx.userId)).orderBy(desc(feeCounters.day), desc(feeCounters.createdAt)).limit(limit))
      .then((rows) => rows.map(({ c, name }) => ({ ...c, cashier: name ?? "-", differencePaise: c.countedPaise == null || c.expectedPaise == null ? null : c.countedPaise - c.expectedPaise })));
  }

  /** The handover slip of a counter: figures, notes and coins, and a line to sign. Only the cashier, or staff who may read, can print it. */
  async slipFile(id: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const got = await this.read("collect", async (tx) => {
      const [c] = await tx.select({ c: feeCounters, name: users.name }).from(feeCounters).leftJoin(users, eq(users.id, feeCounters.userId)).where(eq(feeCounters.id, id));
      if (!c) throw new NotFoundError("Counter");
      if (c.c.userId !== this.ctx.userId && !this.can("read")) throw new ForbiddenError();
      const [school] = await tx.select({ name: schools.name }).from(schools).limit(1);
      return { ...c, school: school?.name ?? "School" };
    });
    const c = got.c, money = PdfBuilder.money;
    const pdf = await PdfBuilder.create();
    pdf.header({ title: "CASH HANDOVER SLIP", orgName: got.school, rightLines: [`Day: ${c.day}`] });
    pdf.facts([["Cashier", got.name ?? "-"], ["Float at opening", money(c.floatPaise)], ["Should be in the box", c.expectedPaise == null ? "Still open" : money(c.expectedPaise)], ["Counted", c.countedPaise == null ? "Still open" : money(c.countedPaise)],
      ["Difference", c.countedPaise == null || c.expectedPaise == null ? "-" : money(c.countedPaise - c.expectedPaise)], ["Reason", c.differenceReason ?? "-"]]);
    const notes = Object.entries(c.denominations ?? {}).filter(([, n]) => n > 0).sort((a, b) => Number(b[0]) - Number(a[0]));
    if (notes.length) pdf.table({ columns: [{ label: "Note or coin", width: 150 }, { label: "Count", width: 150, align: "right" }, { label: "Amount", width: 149, align: "right" }], rows: notes.map(([p, n]) => [`Rs. ${Number(p) / 100}`, String(n), money(Number(p) * n)]) });
    pdf.space(40).text("Handed over by: ____________________      Received by: ____________________", { size: 9 });
    return { filename: `handover-${c.day}.pdf`, bytes: await pdf.save() };
  }
}
