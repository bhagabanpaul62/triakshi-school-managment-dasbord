import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, NotFoundError, listQuerySchema, toPage, type ListQuery } from "@smw/feature-kit";
import { rupees } from "@smw/feature-kit/money";
import { FeesBase } from "./base";
import { feeInvoiceChanges } from "./schema";

export type Change = typeof feeInvoiceChanges.$inferSelect;
export interface ChangeSpec { kind: Change["kind"]; invoiceId?: string; studentId?: string; payload: Record<string, unknown>; reason: string; lowersPaise: number; title: string; href: string }

/**
 * The rule that no one lowers what a student owes alone. A change that lowers it by more than the school's limit (all
 * the lowering this student has had without a second person counts, so splitting it into small pieces does not help)
 * waits for approval `fees.invoice_change`; anything else is applied at once and kept as `direct`.
 */
export class ChangeService extends FeesBase {
  /** What has been taken off this student's dues with no second person: small cancels, revisions, credit notes and plan changes. */
  async loweredAloneIn(tx: Tx, studentId: string): Promise<number> {
    const [r] = await tx.select({ v: sql<string>`coalesce(sum(${feeInvoiceChanges.lowersPaise}), 0)` }).from(feeInvoiceChanges).where(and(eq(feeInvoiceChanges.studentId, studentId), eq(feeInvoiceChanges.direct, true), eq(feeInvoiceChanges.status, "approved")));
    return Number(r?.v ?? 0);
  }

  /** May this much be taken off alone? Zero or less is never a reduction; a limit of 0 means every reduction needs approval. */
  async mayApplyAloneIn(tx: Tx, studentId: string | undefined, lowersPaise: number): Promise<boolean> {
    if (lowersPaise <= 0) return true;
    const { concessionLimitPaise: limit } = await this.settings(tx);
    return limit > 0 && (studentId ? await this.loweredAloneIn(tx, studentId) : 0) + lowersPaise <= limit;
  }

  async pendingIn(tx: Tx, q: { invoiceId?: string; studentId?: string; kind?: Change["kind"] }) {
    const [row] = await tx.select().from(feeInvoiceChanges).where(and(eq(feeInvoiceChanges.status, "pending"), q.invoiceId ? eq(feeInvoiceChanges.invoiceId, q.invoiceId) : undefined, q.studentId ? eq(feeInvoiceChanges.studentId, q.studentId) : undefined, q.kind ? eq(feeInvoiceChanges.kind, q.kind) : undefined)).limit(1);
    return row ?? null;
  }

  /** Refuse a second request on the same bill (or the same student's plan) while one waits. */
  async assertNoneWaitingIn(tx: Tx, q: { invoiceId?: string; studentId?: string; kind?: Change["kind"] }) {
    const open = await this.pendingIn(tx, q);
    if (open) throw new ConflictError(`There is already a request waiting for approval on this (${open.kind.replace("_", " ")}: ${open.reason}). Withdraw it first, or wait for the decision.`);
  }

  /** Apply `now` at once when it is a small change, otherwise keep the proposal and ask for approval. */
  async submitIn<T>(tx: Tx, spec: ChangeSpec, now: () => Promise<T>): Promise<{ requested: false; value: T } | { requested: true; change: Change }> {
    await this.assertNoneWaitingIn(tx, spec.invoiceId ? { invoiceId: spec.invoiceId } : { studentId: spec.studentId, kind: spec.kind });
    const base = { schoolId: this.ctx.schoolId, kind: spec.kind, invoiceId: spec.invoiceId ?? null, studentId: spec.studentId ?? null, payload: spec.payload, reason: spec.reason, lowersPaise: Math.max(0, spec.lowersPaise), createdBy: this.ctx.userId };
    if (await this.mayApplyAloneIn(tx, spec.studentId, spec.lowersPaise)) {
      const value = await now();
      await tx.insert(feeInvoiceChanges).values({ ...base, status: "approved", direct: true });
      return { requested: false, value };
    }
    const [change] = await tx.insert(feeInvoiceChanges).values({ ...base, status: "pending" }).returning();
    await this.askApproval(tx, { kind: "fees.invoice_change", refType: "fee_invoice_change", refId: change!.id, title: `${spec.title} (takes ${rupees(spec.lowersPaise)} off what is owed)`, amountPaise: spec.lowersPaise, reason: spec.reason, href: spec.href });
    return { requested: true, change: change! };
  }

  /** Keep a note that was applied at once in the same list, so the limit counts it. */
  async recordDirectIn(tx: Tx, c: { kind: Change["kind"]; invoiceId?: string; studentId: string; reason: string; lowersPaise: number }) {
    if (c.lowersPaise > 0) await tx.insert(feeInvoiceChanges).values({ schoolId: this.ctx.schoolId, kind: c.kind, invoiceId: c.invoiceId ?? null, studentId: c.studentId, payload: {}, reason: c.reason, lowersPaise: c.lowersPaise, status: "approved", direct: true, createdBy: this.ctx.userId });
  }

  /** A pending change, locked, for the approval handler to apply. */
  async takeIn(tx: Tx, id: string): Promise<Change> {
    const [c] = await tx.select().from(feeInvoiceChanges).where(eq(feeInvoiceChanges.id, id)).for("update");
    if (!c) throw new NotFoundError("Request");
    if (c.status !== "pending") throw new ConflictError("This request was already decided.");
    await tx.update(feeInvoiceChanges).set({ status: "approved" }).where(eq(feeInvoiceChanges.id, id));
    return c;
  }

  async rejectIn(tx: Tx, id: string) {
    await tx.update(feeInvoiceChanges).set({ status: "rejected" }).where(and(eq(feeInvoiceChanges.id, id), eq(feeInvoiceChanges.status, "pending")));
  }

  /** Take a waiting request back. It stays on file as not approved. */
  async withdraw(id: string): Promise<Change> {
    this.authorize("setup", "write");
    return this.write("setup", async (tx) => {
      await this.withdrawRequest(tx, "fees.invoice_change", id);
      const [c] = await tx.update(feeInvoiceChanges).set({ status: "rejected" }).where(eq(feeInvoiceChanges.id, id)).returning();
      return c!;
    }, (c) => ({ action: "withdraw", entity: "Fee change", entityId: c.id, summary: `Withdrew a request: ${c.reason}` }));
  }

  async list(query: ListQuery = {}) {
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx) => {
      const where = and(q.filters.invoiceId ? eq(feeInvoiceChanges.invoiceId, q.filters.invoiceId) : undefined, q.filters.studentId ? eq(feeInvoiceChanges.studentId, q.filters.studentId) : undefined, q.filters.status ? eq(feeInvoiceChanges.status, q.filters.status as Change["status"]) : undefined);
      const [rows, [n]] = await Promise.all([
        tx.select().from(feeInvoiceChanges).where(where).orderBy(desc(feeInvoiceChanges.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(feeInvoiceChanges).where(where),
      ]);
      return toPage(rows, Number(n?.n ?? 0), q);
    });
  }
}
