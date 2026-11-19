import { z } from "zod";
import { and, asc, count, desc, eq, invoices, plans, schools, subscriptions, withSchool, type Tx } from "@smw/db";
import { NotFoundError, SchoolService, listQuerySchema, toPage, type ListQuery, type Page } from "@smw/feature-kit";
import { billingFeature } from "./feature";
import { checkoutInput } from "./inputs";
import { InvoicePdf } from "./invoice-pdf";
import { PlanCatalog } from "./plans";
import { PlatformBilling } from "./platform-billing";
import { countStudents } from "./util";

type Perm = "read" | "manage";
export type InvoiceRow = typeof invoices.$inferSelect;

export interface BillingOverview {
  school: { name: string; status: string; trialEndsAt: Date | null; state: string | null };
  plan: { key: string; name: string; studentCap: number } | null;
  subscription: { interval: "annual" | "monthly"; status: string; periodStart: Date | null; periodEnd: Date | null; pendingPlanName: string | null } | null;
  students: number;
  cap: number;
  /** Days left in the paid period, or in the trial. Null when there is neither. */
  daysLeft: number | null;
  unpaidInvoices: number;
}

/**
 * The school's view of billing. Reads run in the school's RLS scope; anything that writes our billing rows is handed to
 * PlatformBilling (console role) only after this class has checked the caller is the school's own admin.
 */
export class BillingService extends SchoolService<Perm> {
  protected readonly feature = billingFeature;
  private readonly catalog = new PlanCatalog();

  async overview(now = new Date()): Promise<BillingOverview> {
    return this.read("read", async (tx) => {
      const [school] = await tx.select().from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
      if (!school) throw new NotFoundError("School");
      const [sub] = await tx.select().from(subscriptions)
        .where(and(eq(subscriptions.schoolId, this.ctx.schoolId), eq(subscriptions.status, "active"))).orderBy(desc(subscriptions.createdAt)).limit(1);
      const [plan] = school.planId ? await tx.select().from(plans).where(eq(plans.id, school.planId)).limit(1) : [];
      const pending = sub?.pendingPlanId ? (await tx.select().from(plans).where(eq(plans.id, sub.pendingPlanId)).limit(1))[0] : undefined;
      const [unpaid] = await tx.select({ n: count() }).from(invoices).where(eq(invoices.status, "issued"));
      const end = sub?.currentPeriodEnd ?? (school.status === "trial" ? school.trialEndsAt : null);
      return {
        school: { name: school.name, status: school.status, trialEndsAt: school.trialEndsAt, state: school.state },
        plan: plan ? { key: plan.key, name: plan.name, studentCap: plan.studentCap } : null,
        subscription: sub ? { interval: sub.interval, status: sub.status, periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, pendingPlanName: pending?.name ?? null } : null,
        students: await countStudents(tx, this.ctx.schoolId),
        cap: school.studentCap,
        daysLeft: end ? Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000)) : null,
        unpaidInvoices: Number(unpaid?.n ?? 0),
      };
    });
  }

  async listInvoices(query: ListQuery = {}): Promise<Page<InvoiceRow>> {
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx: Tx) => {
      const status = (["issued", "paid", "void"] as const).find((s) => s === q.filters.status);
      const where = status ? eq(invoices.status, status) : undefined;
      const [rows, total] = await Promise.all([
        tx.select().from(invoices).where(where).orderBy(desc(invoices.createdAt), asc(invoices.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(invoices).where(where),
      ]);
      return toPage(rows, Number(total[0]?.n ?? 0), q);
    });
  }

  /** Public plans for the upgrade cards, plus which one fits the school's student count. */
  async planOptions() {
    return this.read("read", async (tx) => {
      const list = await this.catalog.publicPlans(tx);
      const students = await countStudents(tx, this.ctx.schoolId);
      return { plans: list, recommendedKey: PlanCatalog.recommend(list, students)?.key ?? null, students };
    });
  }

  // A read-only school must still be able to pay, so checkout authorizes in "read" mode (skips the read-only check).
  async startCheckout(input: unknown) {
    this.authorize("manage", "read");
    const data = this.parse(checkoutInput, input);
    const result = await PlatformBilling.forAdmin(this.ctx).startCheckout(data);
    await withSchool(this.ctx.schoolId, (tx) => this.audit(tx, {
      action: result.kind === "checkout" ? "checkout_started" : "downgrade_scheduled", entity: "Subscription", summary: `Chose the ${data.planKey} plan (${data.interval})`,
    }));
    return result;
  }

  async payInvoice(invoiceId: string) {
    this.authorize("manage", "read");
    if (!z.uuid().safeParse(invoiceId).success) throw new NotFoundError("Invoice");
    return PlatformBilling.forAdmin(this.ctx).payInvoice(invoiceId);
  }

  /** Called from the return page: re-checks the order with the gateway, pinned to this school. */
  async confirmOrder(orderId: string) {
    this.authorize("read", "read");
    return PlatformBilling.system().confirmOrder(orderId, { schoolId: this.ctx.schoolId });
  }

  async invoicePdf(invoiceId: string): Promise<{ filename: string; bytes: Uint8Array }> {
    if (!z.uuid().safeParse(invoiceId).success) throw new NotFoundError("Invoice");
    return this.read("read", async (tx) => {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      const [school] = await tx.select().from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
      if (!inv || !school) throw new NotFoundError("Invoice");
      return { filename: `${inv.number.replace(/\//g, "-")}.pdf`, bytes: await InvoicePdf.render(inv, school) };
    });
  }
}
