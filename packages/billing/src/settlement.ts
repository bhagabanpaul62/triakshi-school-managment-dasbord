import { and, eq, inArray, invoices, ne, payments, plans, platformAuditLogs, schools, subscriptions, tdsCertificates, type Tx } from "@smw/db";
import { todayIST } from "@smw/feature-kit/money";
import { ConflictError, NotFoundError } from "@smw/feature-kit";
import { dueOf, tdsQuarter } from "./amounts";
import { AccountCredits } from "./credits";
import { addInterval } from "./util";

export interface SettleResult { invoiceId: string | null; schoolId: string; already: boolean; /** Money that went to the school's account credit instead of the invoice. */ creditedPaise: number }

/**
 * The one place a payment becomes real: payment success -> invoice paid -> subscription active -> school active with the plan's cap.
 * Online (confirmOrder, webhooks) and offline (staff) payments both end here. Idempotent: row locks plus status checks.
 * Money that has no invoice to settle (a second payment, a payment for a cancelled invoice, an overpayment) becomes account credit.
 */
export class Settlement {
  static async apply(tx: Tx, paymentId: string, opts: { now?: Date; gatewayPaymentId?: string | null } = {}): Promise<SettleResult> {
    const now = opts.now ?? new Date();
    const [pay] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!pay) throw new NotFoundError("Payment");
    if (pay.status === "success") return { invoiceId: pay.invoiceId, schoolId: pay.schoolId, already: true, creditedPaise: 0 };

    await tx.update(payments).set({ status: "success", paidAt: pay.paidAt ?? now, gatewayPaymentId: opts.gatewayPaymentId ?? pay.gatewayPaymentId }).where(eq(payments.id, pay.id));
    if (!pay.invoiceId) return { invoiceId: null, schoolId: pay.schoolId, already: false, creditedPaise: 0 };

    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, pay.invoiceId)).for("update");
    if (!inv) throw new NotFoundError("Invoice");
    const credit = (kind: "second_payment" | "voided_payment" | "overpayment", amountPaise: number) =>
      AccountCredits.add(tx, { schoolId: pay.schoolId, amountPaise, kind, sourceKey: `${kind}:${pay.id}`, invoiceId: inv.id, paymentId: pay.id });

    if (inv.status === "paid" || inv.status === "void") {
      // Nothing to activate: the cash is kept as credit for the next invoice.
      await credit(inv.status === "paid" ? "second_payment" : "voided_payment", pay.amountPaise);
      await tx.insert(platformAuditLogs).values({
        schoolId: pay.schoolId, action: "billing.payment_to_credit", summary: `Payment for ${inv.status === "paid" ? "paid" : "cancelled"} invoice ${inv.number} kept as account credit`, meta: { paymentId: pay.id, invoiceId: inv.id },
      });
      return { invoiceId: inv.id, schoolId: pay.schoolId, already: true, creditedPaise: pay.amountPaise };
    }

    const settled = pay.amountPaise + pay.tdsPaise;
    const due = dueOf(inv);
    if (settled < due) throw new ConflictError("This payment is less than what the invoice needs. Our team has been notified.");
    const excess = settled - due;
    if (excess > 0) await credit("overpayment", excess);
    await tx.update(invoices).set({ tdsPaise: pay.tdsPaise }).where(eq(invoices.id, inv.id));
    await this.markPaid(tx, inv, now);
    if (pay.tdsPaise > 0) {
      const q = tdsQuarter(todayIST(pay.paidAt ?? now));
      await tx.insert(tdsCertificates).values({ schoolId: pay.schoolId, invoiceId: inv.id, paymentId: pay.id, amountPaise: pay.tdsPaise, quarter: q.label, remindOn: q.remindOn }).onConflictDoNothing();
    }
    await tx.insert(platformAuditLogs).values({
      schoolId: pay.schoolId, action: "billing.payment_settled", summary: `Invoice ${inv.number} paid (${pay.method})`, meta: { paymentId: pay.id, invoiceId: inv.id, tdsPaise: pay.tdsPaise },
    });
    return { invoiceId: inv.id, schoolId: pay.schoolId, already: false, creditedPaise: excess };
  }

  /** An invoice that needs nothing more (paid, or covered by credit): mark it and switch on what it bought. The invoice row must be locked. */
  static async markPaid(tx: Tx, inv: typeof invoices.$inferSelect, now: Date) {
    await tx.update(invoices).set({ status: "paid", paidAt: now }).where(eq(invoices.id, inv.id));
    if (inv.subscriptionId) await this.activate(tx, inv, now);
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
