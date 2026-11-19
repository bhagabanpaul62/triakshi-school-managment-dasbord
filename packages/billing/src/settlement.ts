import { and, eq, inArray, invoices, ne, payments, plans, platformAuditLogs, schools, subscriptions, type Tx } from "@smw/db";
import { ConflictError, NotFoundError } from "@smw/feature-kit";
import { addInterval } from "./util";

export interface SettleResult { invoiceId: string | null; schoolId: string; already: boolean }

/**
 * The one place a payment becomes real: payment success -> invoice paid -> subscription active -> school active with the plan's cap.
 * Online (confirmOrder, webhooks) and offline (staff) payments both end here. Idempotent: row locks plus status checks.
 */
export class Settlement {
  static async apply(tx: Tx, paymentId: string, opts: { now?: Date; gatewayPaymentId?: string | null } = {}): Promise<SettleResult> {
    const now = opts.now ?? new Date();
    const [pay] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!pay) throw new NotFoundError("Payment");
    if (pay.status === "success") return { invoiceId: pay.invoiceId, schoolId: pay.schoolId, already: true };

    await tx.update(payments).set({ status: "success", paidAt: pay.paidAt ?? now, gatewayPaymentId: opts.gatewayPaymentId ?? pay.gatewayPaymentId }).where(eq(payments.id, pay.id));
    if (!pay.invoiceId) return { invoiceId: null, schoolId: pay.schoolId, already: false };

    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, pay.invoiceId)).for("update");
    if (!inv) throw new NotFoundError("Invoice");
    if (inv.status === "paid") return { invoiceId: inv.id, schoolId: pay.schoolId, already: true }; // a second payment for a paid invoice: recorded, nothing to activate
    if (inv.status === "void") throw new ConflictError("This invoice was cancelled.");
    await tx.update(invoices).set({ status: "paid", paidAt: now }).where(eq(invoices.id, inv.id));

    if (inv.subscriptionId) await this.activate(tx, inv, now);
    await tx.insert(platformAuditLogs).values({
      schoolId: pay.schoolId, action: "billing.payment_settled", summary: `Invoice ${inv.number} paid (${pay.method})`, meta: { paymentId: pay.id, invoiceId: inv.id },
    });
    return { invoiceId: inv.id, schoolId: pay.schoolId, already: false };
  }

  private static async activate(tx: Tx, inv: typeof invoices.$inferSelect, now: Date) {
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.id, inv.subscriptionId!)).for("update");
    if (!sub || sub.status === "active") return;
    const [plan] = await tx.select().from(plans).where(eq(plans.id, sub.planId)).limit(1);
    if (!plan) throw new NotFoundError("Plan");

    const others = await tx.select({ id: subscriptions.id }).from(subscriptions)
      .where(and(eq(subscriptions.schoolId, sub.schoolId), ne(subscriptions.id, sub.id), inArray(subscriptions.status, ["active", "past_due"])));
    // Renewal or upgrade keeps the dates fixed at checkout; a first purchase (or a lapsed one) starts the day it is paid.
    const keep = others.length > 0 && inv.periodStart && inv.periodEnd && inv.periodEnd > now;
    const start = keep ? inv.periodStart! : now;
    const end = keep ? inv.periodEnd! : addInterval(now, sub.interval);

    if (others.length) await tx.update(subscriptions).set({ status: "cancelled" }).where(inArray(subscriptions.id, others.map((o) => o.id)));
    await tx.update(subscriptions).set({ status: "active", currentPeriodStart: start, currentPeriodEnd: end, pendingPlanId: null }).where(eq(subscriptions.id, sub.id));

    const [school] = await tx.select().from(schools).where(eq(schools.id, sub.schoolId)).limit(1);
    if (!school) throw new NotFoundError("School");
    const reactivate = school.status !== "cancelled";
    await tx.update(schools).set({
      planId: plan.id, studentCap: plan.studentCap, trialEndsAt: null, deletionScheduledAt: null,
      ...(reactivate && school.status !== "active" ? { status: "active" as const, statusChangedAt: now } : {}),
    }).where(eq(schools.id, school.id));
  }
}
