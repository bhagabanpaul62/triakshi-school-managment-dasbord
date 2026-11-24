import { randomBytes } from "node:crypto";
import { env, schoolUrl } from "@smw/config";
import { and, between, desc, eq, inArray, invoices, payments, plans, platformAuditLogs, schools, subscriptions, users, withConsole, type Tx } from "@smw/db";
import { ConflictError, ForbiddenError, LimitError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { services } from "@smw/integrations";
import { dueOf } from "./amounts";
import { AccountCredits } from "./credits";
import { PaymentGatewayError } from "./errors";
import { ensureGateway } from "./gateway";
import { GstCalculator } from "./gst";
import { InvoiceNumberer } from "./invoice-number";
import { PlanCatalog, type PlanView } from "./plans";
import { ProrationCalculator } from "./proration";
import { Settlement } from "./settlement";
import { TdsCertificates } from "./tds";
import { addDays, addInterval, countStudents, dmy } from "./util";

export type Interval = "annual" | "monthly";
export interface CheckoutResult { kind: "checkout"; invoiceId: string; orderId: string; checkoutUrl: string; amountPaise: number }
/** The invoice was covered by account credit, so there is nothing to pay. */
export interface PaidResult { kind: "paid"; invoiceId: string }
export interface ScheduledResult { kind: "scheduled"; planName: string; effectiveAt: Date }
export type ConfirmState = "paid" | "pending" | "failed";
export interface ConfirmResult { state: ConfirmState; invoiceId: string | null; schoolId: string; /** Money kept as account credit because the invoice no longer needed it. */ creditedPaise?: number }

const priceOf = (p: PlanView, i: Interval) => (i === "annual" ? p.priceAnnualPaise : p.priceMonthlyPaise);

/**
 * Everything that writes our own billing rows. These tables are console-only (the school role cannot INSERT/UPDATE
 * invoices, payments or subscriptions), so every method runs through `withConsole`.
 *
 * TRUST BOUNDARY: the console role bypasses RLS, so this class must never be handed an unchecked school id.
 * - School callers go through `PlatformBilling.forAdmin(ctx)`, which refuses anyone but a school admin and pins
 *   every query to `ctx.schoolId`. BillingService (the school side) is the only caller.
 * - `confirmOrder` is safe for anyone because it only re-asks the gateway; pass `schoolId` to also pin it to a school.
 * - System callers (webhooks, lifecycle job, console staff) construct `new PlatformBilling()` themselves.
 */
export class PlatformBilling {
  private readonly catalog = new PlanCatalog();
  private readonly gst = new GstCalculator(env().PLATFORM_STATE);
  private readonly numberer = new InvoiceNumberer();

  private constructor(private readonly scope: { schoolId: string; userId: string } | null) {}

  static forAdmin(ctx: Pick<Ctx, "role" | "schoolId" | "userId">) {
    if (ctx.role !== "admin") throw new ForbiddenError();
    return new PlatformBilling({ schoolId: ctx.schoolId, userId: ctx.userId });
  }
  static system() { return new PlatformBilling(null); }

  private need() {
    if (!this.scope) throw new ForbiddenError();
    return this.scope;
  }

  private gateway() {
    ensureGateway();
    return services().payments;
  }

  // ---------- checkout ----------

  /** Start paying for a plan: new purchase, renewal, prorated upgrade, or (for a downgrade) schedule it for renewal. */
  async startCheckout(input: { planKey: string; interval: Interval }, now = new Date()): Promise<CheckoutResult | ScheduledResult | PaidResult> {
    const { schoolId } = this.need();
    const prepared = await withConsole(async (tx) => {
      const plan = await this.catalog.byKey(tx, input.planKey);
      if (!plan) throw new ValidationError({ planKey: "Pick a plan" });
      const [school] = await tx.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
      if (!school) throw new NotFoundError("School");
      const students = await countStudents(tx, schoolId);
      if (students > plan.studentCap) throw new LimitError(`You have ${students.toLocaleString("en-IN")} students. ${plan.name} covers up to ${plan.studentCap.toLocaleString("en-IN")}. Pick a bigger plan.`);

      const [current] = await tx.select().from(subscriptions)
        .where(and(eq(subscriptions.schoolId, schoolId), inArray(subscriptions.status, ["active", "past_due"]))).orderBy(desc(subscriptions.createdAt)).limit(1);
      const live = current && current.status === "active" && current.currentPeriodEnd && current.currentPeriodEnd > now ? current : null;

      let amount = priceOf(plan, input.interval);
      let start = now;
      let end = addInterval(now, input.interval);
      let label = `${plan.name} plan, ${input.interval}`;

      if (live) {
        if (live.interval !== input.interval) throw new ValidationError({ interval: "Switch between monthly and annual when your current period ends." });
        const curEnd = live.currentPeriodEnd!;
        if (live.planId === plan.id || live.pendingPlanId === plan.id) {
          start = curEnd; end = addInterval(curEnd, input.interval); // renewal, starts when the paid period ends
        } else {
          const [old] = await tx.select().from(plans).where(eq(plans.id, live.planId)).limit(1);
          const quote = ProrationCalculator.quote({ oldPaise: live.pricePaise, newPaise: amount, periodStart: live.currentPeriodStart ?? now, periodEnd: curEnd, now });
          if (quote.kind === "downgrade") {
            await tx.update(subscriptions).set({ pendingPlanId: plan.id }).where(eq(subscriptions.id, live.id));
            await tx.insert(platformAuditLogs).values({ schoolId, action: "billing.downgrade_scheduled", summary: `${old?.name ?? "Plan"} to ${plan.name} at renewal`, meta: { planId: plan.id } });
            return { scheduled: { kind: "scheduled", planName: plan.name, effectiveAt: curEnd } as ScheduledResult, invoiceId: null, covered: false };
          }
          if (quote.kind === "same") throw new ConflictError("You are already on this plan.");
          amount = quote.amountPaise; start = now; end = curEnd;
          label = `Upgrade to ${plan.name} plan, prorated for ${quote.remainingDays} days`;
        }
      }
      if (amount <= 0) throw new ConflictError("Nothing to pay for this change.");

      const split = this.gst.compute(amount, school.state);
      // Clicking "Choose plan" twice must not pile up unpaid invoices: reuse the open one for the same plan, interval and amount.
      // A new purchase's period end moves with the clock, so match it within a day rather than exactly.
      const [open] = await tx.select({ id: invoices.id }).from(invoices).innerJoin(subscriptions, eq(subscriptions.id, invoices.subscriptionId))
        .where(and(eq(invoices.schoolId, schoolId), eq(invoices.status, "issued"), eq(invoices.taxablePaise, split.taxablePaise),
          between(invoices.periodEnd, addDays(end, -1), addDays(end, 1)),
          eq(subscriptions.status, "pending"), eq(subscriptions.planId, plan.id), eq(subscriptions.interval, input.interval))).limit(1);
      if (open) return { scheduled: null, invoiceId: open.id, covered: false };
      const [sub] = await tx.insert(subscriptions).values({
        schoolId, planId: plan.id, interval: input.interval, status: "pending", pricePaise: priceOf(plan, input.interval),
        currentPeriodStart: start, currentPeriodEnd: end,
      }).returning();
      const inv = await this.issueInvoice(tx, { school, subscriptionId: sub!.id, description: `${label} (${dmy(start)} to ${dmy(end)})`, split, start, end, now });
      return { scheduled: null, invoiceId: inv.id, covered: inv.status === "paid" };
    });
    if (prepared.scheduled) return prepared.scheduled;
    if (prepared.covered) return { kind: "paid", invoiceId: prepared.invoiceId! };
    return this.openOrder(prepared.invoiceId!, now);
  }

  /** Pay an invoice that is already issued (the "Pay now" button): a fresh gateway order for the same invoice. */
  async payInvoice(invoiceId: string, now = new Date()): Promise<CheckoutResult> {
    const { schoolId } = this.need();
    if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) throw new NotFoundError("Invoice");
    const [inv] = await withConsole((tx) => tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.schoolId, schoolId))).limit(1));
    if (!inv) throw new NotFoundError("Invoice");
    if (inv.status !== "issued") throw new ConflictError(inv.status === "paid" ? "This invoice is already paid." : "This invoice cannot be paid.");
    return this.openOrder(inv.id, now);
  }

  private async issueInvoice(tx: Tx, p: { school: typeof schools.$inferSelect; subscriptionId: string; description: string; split: ReturnType<GstCalculator["compute"]>; start: Date; end: Date; now: Date }) {
    const { number, financialYear } = await this.numberer.next(tx, p.now);
    const [inv] = await tx.insert(invoices).values({
      schoolId: p.school.id, subscriptionId: p.subscriptionId, number, financialYear, status: "issued", description: p.description,
      taxablePaise: p.split.taxablePaise, cgstPaise: p.split.cgstPaise, sgstPaise: p.split.sgstPaise, igstPaise: p.split.igstPaise, totalPaise: p.split.totalPaise,
      schoolGstin: p.school.gstin, placeOfSupply: p.school.state, dueAt: addDays(p.now, 7), periodStart: p.start, periodEnd: p.end,
    }).returning();
    await tx.insert(platformAuditLogs).values({ schoolId: p.school.id, action: "billing.invoice_issued", summary: `Invoice ${number} issued`, meta: { invoiceId: inv!.id } });
    // Credit the school already holds pays first; an invoice it fully covers is paid without a payment.
    const used = await AccountCredits.useOn(tx, inv!);
    if (used === 0) return inv!;
    const now = { ...inv!, creditAppliedPaise: used };
    if (dueOf(now) > 0) return now;
    await Settlement.markPaid(tx, now, p.now);
    return { ...now, status: "paid" as const };
  }

  private async openOrder(invoiceId: string, now: Date): Promise<CheckoutResult> {
    const scope = this.need();
    const gw = this.gateway();
    const ctxRows = await withConsole(async (tx) => {
      const [inv] = await tx.select().from(invoices).where(and(eq(invoices.id, invoiceId), eq(invoices.schoolId, scope.schoolId))).limit(1);
      const [school] = await tx.select().from(schools).where(eq(schools.id, scope.schoolId)).limit(1);
      const [user] = await tx.select().from(users).where(and(eq(users.id, scope.userId), eq(users.schoolId, scope.schoolId))).limit(1);
      if (!inv || !school) throw new NotFoundError("Invoice");
      if (inv.status !== "issued") throw new ConflictError("This invoice is already settled.");
      const orderId = `trk_${randomBytes(9).toString("hex")}`;
      const [pay] = await tx.insert(payments).values({ schoolId: school.id, invoiceId: inv.id, amountPaise: dueOf(inv), method: "cashfree", status: "created", gatewayOrderId: orderId }).returning();
      return { inv, school, user, orderId, paymentId: pay!.id };
    });
    const { inv, school, user, orderId, paymentId } = ctxRows;

    const email = user?.email ?? school.email ?? (gw.name === "fake" ? "billing@example.test" : null);
    const rawPhone = (user?.phone ?? school.phone ?? "").replace(/\D/g, "").slice(-10);
    const phone = /^[6-9]\d{9}$/.test(rawPhone) ? rawPhone : gw.name === "fake" ? "9999999999" : null;
    if (!email) throw new ValidationError({ email: "Add an email address to your profile before paying." });
    if (!phone) throw new ValidationError({ phone: "Add a 10-digit mobile number to the school profile before paying." });

    try {
      const order = await gw.createOrder({
        orderId, amountPaise: dueOf(inv),
        customer: { id: school.id.replace(/-/g, ""), name: user?.name ?? school.name, email, phone },
        returnUrl: schoolUrl(school.slug, `/app/billing/return?order_id=${orderId}`),
        notifyUrl: `${env().CONSOLE_URL}/api/webhooks/cashfree`,
        note: `Invoice ${inv.number}`,
      });
      return { kind: "checkout", invoiceId: inv.id, orderId, checkoutUrl: order.checkoutUrl, amountPaise: dueOf(inv) };
    } catch (err) {
      await withConsole((tx) => tx.update(payments).set({ status: "failed" }).where(eq(payments.id, paymentId)));
      console.error(JSON.stringify({ level: "error", msg: "gateway createOrder failed", err: String(err), invoice: inv.number, at: now.toISOString() }));
      throw new PaymentGatewayError();
    }
  }

  /** The school's TDS certificates, pinned to this school. */
  tds() { return new TdsCertificates(this.need().schoolId); }

  // ---------- confirmation ----------

  /** Ask the gateway what happened to this order and apply it. Never trusts a redirect or a webhook body. Idempotent. */
  async confirmOrder(orderId: string, opts: { schoolId?: string; now?: Date } = {}): Promise<ConfirmResult> {
    const pinned = opts.schoolId ?? this.scope?.schoolId;
    const [pay] = await withConsole((tx) => tx.select().from(payments).where(eq(payments.gatewayOrderId, orderId)).limit(1));
    if (!pay || (pinned && pay.schoolId !== pinned)) throw new NotFoundError("Order");
    if (pay.status === "success") return { state: "paid", invoiceId: pay.invoiceId, schoolId: pay.schoolId };

    const remote = await this.gateway().getOrderStatus(orderId);
    if (remote.status === "PAID") {
      if (remote.amountPaise !== pay.amountPaise) {
        console.error(JSON.stringify({ level: "error", msg: "payment amount mismatch", orderId, expected: pay.amountPaise, got: remote.amountPaise }));
        throw new ConflictError("The amount paid does not match the invoice. Our team has been notified.");
      }
      const r = await withConsole((tx) => Settlement.apply(tx, pay.id, { now: opts.now, gatewayPaymentId: remote.paymentId }));
      return { state: "paid", invoiceId: r.invoiceId, schoolId: r.schoolId, creditedPaise: r.creditedPaise };
    }
    if (remote.status === "EXPIRED" || remote.status === "TERMINATED") {
      await withConsole((tx) => tx.update(payments).set({ status: "failed" }).where(and(eq(payments.id, pay.id), eq(payments.status, "created"))));
      return { state: "failed", invoiceId: pay.invoiceId, schoolId: pay.schoolId };
    }
    return { state: "pending", invoiceId: pay.invoiceId, schoolId: pay.schoolId };
  }
}
