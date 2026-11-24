import { and, desc, eq, sql, sum } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, NotFoundError, listQuerySchema, toPage, type ListQuery } from "@smw/feature-kit";
import { rupees, todayIST } from "@smw/feature-kit/money";
import { cashAccount } from "@smw/feature-finance/posting";
import { FeesBase, asId } from "./base";
import { refundVoucherData } from "./documents";
import { refundInput } from "./inputs";
import { feeAdvances, feeRefunds } from "./schema";

export type Refund = typeof feeRefunds.$inferSelect;

/** Money back to a family from an advance or a deposit. Needs approval `fees.refund`; the balance can never go below zero. */
export class RefundService extends FeesBase {
  /** What can still be asked for: the balance minus refunds already waiting. */
  async availableIn(tx: Tx, studentId: string, source: Refund["source"], exceptId?: string): Promise<number> {
    const [waiting] = await tx.select({ v: sum(feeRefunds.amountPaise) }).from(feeRefunds)
      .where(and(eq(feeRefunds.studentId, studentId), eq(feeRefunds.source, source), eq(feeRefunds.status, "pending"), exceptId ? sql`${feeRefunds.id} <> ${exceptId}` : undefined));
    const balance = source === "advance" ? await this.advanceOf(tx, studentId) : await this.depositHeld(tx, studentId);
    return balance - Number(waiting?.v ?? 0);
  }

  async propose(input: unknown): Promise<Refund> {
    this.authorize("concede", "write");
    const d = this.parse(refundInput, input);
    return this.write("concede", (tx) => this.requestIn(tx, d), (r) => ({ action: "propose", entity: "Refund", entityId: r.id, summary: `Asked to refund ${rupees(r.amountPaise)} from the ${r.source}` }));
  }

  /** Save a request and ask for approval. Used by propose and by the leaving-student settle-up. */
  async requestIn(tx: Tx, d: { studentId: string; source: Refund["source"]; amountPaise: number; method: Refund["method"]; cashAccountId?: string; reference?: string; reason: string }, id?: string): Promise<Refund> {
    await this.lockStudents(tx, [d.studentId]);
    const available = await this.availableIn(tx, d.studentId, d.source, id);
    if (d.amountPaise > available) throw new ConflictError(`Only ${rupees(Math.max(0, available))} of the ${d.source} is available to refund (money already asked for is counted).`);
    if (d.cashAccountId) await cashAccount(tx, this.ctx.schoolId, { id: d.cashAccountId, kind: d.method === "cash" ? "cash" : "bank" });
    const values = { studentId: d.studentId, source: d.source, amountPaise: d.amountPaise, method: d.method, cashAccountId: d.cashAccountId ?? null, reference: d.reference ?? null, reason: d.reason, status: "pending" as const, createdBy: this.ctx.userId };
    const [row] = id ? await tx.update(feeRefunds).set(values).where(eq(feeRefunds.id, id)).returning() : await tx.insert(feeRefunds).values({ schoolId: this.ctx.schoolId, ...values }).returning();
    await this.askApproval(tx, { kind: "fees.refund", refType: "fee_refund", refId: row!.id, title: `Refund ${rupees(d.amountPaise)} to the family`, amountPaise: d.amountPaise, reason: d.reason, href: `/app/fees/students/${d.studentId}` });
    return row!;
  }

  /** Take a waiting request back. It stays on file and can be edited and sent again. */
  async withdraw(id: string) {
    this.authorize("concede", "write");
    return this.write("concede", async (tx) => {
      await this.withdrawRequest(tx, "fees.refund", id);
      const [r] = await tx.update(feeRefunds).set({ status: "rejected" }).where(eq(feeRefunds.id, id)).returning();
      return r!;
    }, (r) => ({ action: "withdraw", entity: "Refund", entityId: r.id, summary: "Withdrew a refund request" }));
  }

  /** Edit a refused or withdrawn request and send it again. */
  async resubmit(id: string, input: unknown): Promise<Refund> {
    this.authorize("concede", "write");
    const d = this.parse(refundInput, input);
    return this.write("concede", async (tx) => {
      const [cur] = await tx.select().from(feeRefunds).where(eq(feeRefunds.id, id)).for("update");
      if (!cur) throw new NotFoundError("Refund");
      if (cur.status !== "rejected") throw new ConflictError("Only a refund that was not approved can be edited and sent again.");
      return this.requestIn(tx, { ...d, studentId: cur.studentId }, id);
    }, (r) => ({ action: "resubmit", entity: "Refund", entityId: r.id, summary: "Sent a refund request again" }));
  }

  async list(query: ListQuery = {}) {
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx) => {
      const where = and(q.filters.status ? eq(feeRefunds.status, q.filters.status as Refund["status"]) : undefined, q.filters.studentId ? eq(feeRefunds.studentId, q.filters.studentId) : undefined);
      const [rows, [n]] = await Promise.all([
        tx.select().from(feeRefunds).where(where).orderBy(desc(feeRefunds.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(feeRefunds).where(where),
      ]);
      return toPage(rows, Number(n?.n ?? 0), q);
    });
  }

  /** Approved: voucher number, the list row, and Dr advances (or deposits) Cr cash or bank. Re-checks the balance. */
  async approveIn(tx: Tx, id: string) {
    const [pre] = await tx.select().from(feeRefunds).where(eq(feeRefunds.id, id));
    if (!pre) throw new NotFoundError("Refund");
    await this.lockStudents(tx, [pre.studentId]);
    const [r] = await tx.select().from(feeRefunds).where(eq(feeRefunds.id, id)).for("update");
    if (r!.status !== "pending") throw new ConflictError("This refund was already decided.");
    const available = await this.availableIn(tx, r!.studentId, r!.source, r!.id);
    if (r!.amountPaise > available) throw new ConflictError(`The ${r!.source} is only ${rupees(Math.max(0, available))} now, so ${rupees(r!.amountPaise)} cannot be refunded.`);
    const date = todayIST();
    const acct = await cashAccount(tx, this.ctx.schoolId, { id: r!.cashAccountId, kind: r!.method === "cash" ? "cash" : "bank" });
    const number = await this.number(tx, "voucher", date);
    const [row] = await tx.update(feeRefunds).set({ status: "approved", number, paidOn: date, cashAccountId: acct.id }).where(eq(feeRefunds.id, id)).returning();
    await tx.insert(feeAdvances).values({ schoolId: this.ctx.schoolId, studentId: r!.studentId, kind: r!.source === "advance" ? "refund" : "deposit", amountPaise: -r!.amountPaise, refId: r!.id, note: `Refund ${number}`, date });
    await this.post(tx, { date, sourceKey: `fees:refund:${r!.id}`, sourceType: "fee_student", sourceId: r!.studentId, memo: `Refund ${number}: ${r!.reason}`,
      lines: [{ account: r!.source === "advance" ? "student_advances" : "deposits_payable", debit: r!.amountPaise, party: { type: "student", id: r!.studentId } }, { account: { id: acct.accountId }, credit: r!.amountPaise }] });
    await this.tell(tx, [r!.studentId], "Refund approved", `${rupees(r!.amountPaise)} will be returned to you (voucher ${number}).`);
    return row!;
  }

  async rejectIn(tx: Tx, id: string) {
    await tx.update(feeRefunds).set({ status: "rejected" }).where(and(eq(feeRefunds.id, id), eq(feeRefunds.status, "pending")));
  }

  /** The voucher of an approved refund as a PDF. */
  async refundVoucherFile(id: string): Promise<{ filename: string; bytes: Uint8Array }> {
    const doc = await this.viewer(async (tx, own) => {
      const [r] = await tx.select().from(feeRefunds).where(eq(feeRefunds.id, asId(id, "Refund")));
      if (!r) throw new NotFoundError("Refund");
      this.assertVisible(own, r.studentId, "Refund");
      if (r.status !== "approved" || !r.number || !r.paidOn) throw new ConflictError("This refund has no voucher yet. It is made when the refund is approved.");
      const snapshot = await this.snapshot(tx, await this.oneStudent(tx, r.studentId));
      return { r, data: refundVoucherData({ number: r.number, date: r.paidOn, snapshot, source: r.source, method: r.method, reference: r.reference, reason: r.reason, amountPaise: r.amountPaise }) };
    });
    const { bytes, copyNo } = await this.templates().print("voucher", doc.data, { docType: "fee_refund", docId: id });
    return { filename: `${doc.r.number!.replace(/\//g, "-")}${copyNo > 1 ? "-duplicate" : ""}.pdf`, bytes };
  }
}
