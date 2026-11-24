import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ConflictError, ForbiddenError, NotFoundError, listQuerySchema, toPage, type ListQuery } from "@smw/feature-kit";
import { addDays, rupees, todayIST } from "@smw/feature-kit/money";
import { pgErrorCode } from "@smw/feature-kit";
import { students } from "@smw/feature-students/schema";
import { FeesBase } from "./base";
import { rejectSlipInput, slipInput } from "./inputs";
import { ReceiptService } from "./receipts";
import { feeInvoices, feeUpiSlips } from "./schema";

export type Slip = typeof feeUpiSlips.$inferSelect;

/** A family says "I paid by UPI". Nothing is paid until the office checks the bank and verifies; then the receipt is made by the normal collect. */
export class SlipService extends FeesBase {
  /** A student login sends a slip for their own bills. A rejected slip is simply sent again with the right UTR. */
  async submit(input: unknown): Promise<Slip> {
    this.authorize("self", "write");
    const d = this.parse(slipInput, input);
    return this.write("self", async (tx) => {
      const { upiOn } = await this.settings(tx);
      if (!upiOn) throw new ConflictError("The school has not turned on UPI payments. Pay at the school office, or ask them to enable it.");
      const own = await this.ownStudentIds(tx);
      if (!own.length) throw new ForbiddenError();
      const bills = await tx.select({ id: feeInvoices.id, s: feeInvoices.studentId, status: feeInvoices.status }).from(feeInvoices).where(inArray(feeInvoices.id, d.invoiceIds));
      if (bills.length !== new Set(d.invoiceIds).size || bills.some((b) => !own.includes(b.s))) throw new NotFoundError("Bill");
      if (bills.some((b) => b.status !== "issued")) throw new ConflictError("Pick bills that are issued and not cancelled.");
      if (d.paidOn > todayIST()) throw new ConflictError("The payment date cannot be in the future.");
      try {
        const [row] = await tx.insert(feeUpiSlips).values({ schoolId: this.ctx.schoolId, studentId: bills[0]!.s, amountPaise: d.amountPaise, utr: d.utr, paidOn: d.paidOn, invoiceIds: d.invoiceIds, fileKey: d.fileKey ?? null }).returning();
        return row!;
      } catch (e) {
        if (pgErrorCode(e) === "23505") throw new ConflictError("This UTR was already sent. If the school rejected it, check the reason on your fees page and send the right one.");
        throw e;
      }
    }, (s) => ({ action: "submit", entity: "UPI slip", entityId: s.id, summary: `UPI payment of ${rupees(s.amountPaise)} reported (UTR ${s.utr})` }));
  }

  async list(query: ListQuery = {}) {
    const q = listQuerySchema.parse(query);
    return this.viewer(async (tx, own) => {
      const where = and(own ? inArray(feeUpiSlips.studentId, own.length ? own : ["00000000-0000-0000-0000-000000000000"]) : undefined, q.filters.status ? eq(feeUpiSlips.status, q.filters.status as Slip["status"]) : undefined, q.filters.studentId ? eq(feeUpiSlips.studentId, q.filters.studentId) : undefined);
      const [rows, [n]] = await Promise.all([
        tx.select({ s: feeUpiSlips, studentName: students.name, admissionNo: students.admissionNo }).from(feeUpiSlips).innerJoin(students, eq(students.id, feeUpiSlips.studentId)).where(where).orderBy(desc(feeUpiSlips.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(feeUpiSlips).where(where),
      ]);
      return toPage(rows.map((r) => ({ ...r.s, studentName: r.studentName, admissionNo: r.admissionNo })), Number(n?.n ?? 0), q);
    });
  }

  /** The office has seen the money in the bank: make the receipt (by collect, so every rule holds) and link it. */
  async verify(id: string) {
    this.authorize("collect", "write");
    return this.write("collect", async (tx) => {
      const [s] = await tx.select().from(feeUpiSlips).where(eq(feeUpiSlips.id, id)).for("update");
      if (!s) throw new NotFoundError("UPI slip");
      if (s.status !== "submitted") throw new ConflictError(`This slip is already ${s.status}.`);
      const { backdateDays } = await this.settings(tx);
      const receipt = await new ReceiptService(this.ctx).collectIn(tx, {
        studentId: s.studentId, date: s.paidOn >= addDays(todayIST(), -backdateDays) ? s.paidOn : todayIST(), invoiceIds: s.invoiceIds,
        methods: [{ method: "upi", amountPaise: s.amountPaise, reference: s.utr }], note: `UPI slip, UTR ${s.utr}`,
      });
      const [row] = await tx.update(feeUpiSlips).set({ status: "verified", receiptId: receipt.id, decidedBy: this.ctx.userId, decidedAt: new Date() }).where(eq(feeUpiSlips.id, id)).returning();
      return { slip: row!, receipt };
    }, (r) => ({ action: "verify", entity: "UPI slip", entityId: r.slip.id, summary: `Verified UPI slip, receipt ${r.receipt.number}` }));
  }

  /** Not matched: the family sees the reason and can send it again. */
  async reject(input: unknown) {
    this.authorize("collect", "write");
    const d = this.parse(rejectSlipInput, input);
    return this.write("collect", async (tx) => {
      const [s] = await tx.update(feeUpiSlips).set({ status: "rejected", reason: d.reason, decidedBy: this.ctx.userId, decidedAt: new Date() }).where(and(eq(feeUpiSlips.id, d.id), eq(feeUpiSlips.status, "submitted"))).returning();
      if (!s) throw new ConflictError("This slip is not waiting for a decision.");
      await this.tell(tx, [s.studentId], "UPI payment not matched", `We could not match UTR ${s.utr}: ${d.reason}. Please send it again with the right details.`);
      return s;
    }, (s) => ({ action: "reject", entity: "UPI slip", entityId: s.id, summary: `Rejected UPI slip: ${d.reason}` }));
  }
}
