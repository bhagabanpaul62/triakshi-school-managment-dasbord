import { z } from "zod";
import { accountCredits, and, asc, count, creditNotes, desc, eq, invoices, payments, plans, schools, subscriptions, tdsCertificates, withSchool, type Tx } from "@smw/db";
import { NotFoundError, SchoolService, listQuerySchema, toPage, type ListQuery, type Page } from "@smw/feature-kit";
import { services } from "@smw/integrations";
import { dueOf } from "./amounts";
import { AccountCredits } from "./credits";
import { CreditNotes } from "./credit-notes";
import { billingFeature } from "./feature";
import { checkoutInput } from "./inputs";
import { InvoicePdf } from "./invoice-pdf";
import { PlanCatalog } from "./plans";
import { PlatformBilling } from "./platform-billing";
import { loadStatement, type Statement } from "./statement";
import { StatementPdf } from "./statement-pdf";
import type { UploadedFile } from "./tds";
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
  /** TDS certificates the school still has to upload. */
  tdsAwaited: number;
  /** Credit Triakshi holds for the school; the next invoice uses it. */
  creditPaise: number;
}

export interface PaymentRow {
  id: string; invoiceId: string | null; invoiceNumber: string | null; amountPaise: number; tdsPaise: number; method: string; reference: string | null; paidAt: Date | null;
  certificate: { id: string; status: "awaited" | "received" | "verified"; quarter: string; note: string | null; fileName: string | null } | null;
}
export interface CreditNoteView { id: string; number: string; invoiceId: string; invoiceNumber: string; kind: string; reason: string; totalPaise: number; settlement: string; refundedAt: Date | null; createdAt: Date }
export interface Owing { duePaise: number; creditPaise: number; invoices: { id: string; number: string; description: string; duePaise: number; dueAt: Date | null; overdue: boolean }[] }

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
      const [awaited] = await tx.select({ n: count() }).from(tdsCertificates).where(eq(tdsCertificates.status, "awaited"));
      const end = sub?.currentPeriodEnd ?? (school.status === "trial" ? school.trialEndsAt : null);
      return {
        school: { name: school.name, status: school.status, trialEndsAt: school.trialEndsAt, state: school.state },
        plan: plan ? { key: plan.key, name: plan.name, studentCap: plan.studentCap } : null,
        subscription: sub ? { interval: sub.interval, status: sub.status, periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, pendingPlanName: pending?.name ?? null } : null,
        students: await countStudents(tx, this.ctx.schoolId),
        cap: school.studentCap,
        daysLeft: end ? Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000)) : null,
        unpaidInvoices: Number(unpaid?.n ?? 0),
        tdsAwaited: Number(awaited?.n ?? 0),
        creditPaise: await AccountCredits.balance(tx, this.ctx.schoolId),
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

  // ---------- what the school owes, has paid and holds in credit ----------

  /** Unpaid invoices, oldest first, with what is still due on each (account credit and credit notes already taken off). */
  async owing(now = new Date()): Promise<Owing> {
    return this.read("read", async (tx) => {
      const open = await tx.select().from(invoices).where(eq(invoices.status, "issued")).orderBy(asc(invoices.dueAt), asc(invoices.createdAt), asc(invoices.id));
      return {
        duePaise: open.reduce((n, i) => n + dueOf(i), 0), creditPaise: await AccountCredits.balance(tx, this.ctx.schoolId),
        invoices: open.map((i) => ({ id: i.id, number: i.number, description: i.description, duePaise: dueOf(i), dueAt: i.dueAt, overdue: !!i.dueAt && i.dueAt < now })),
      };
    });
  }

  async listPayments(query: ListQuery = {}): Promise<Page<PaymentRow>> {
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx) => {
      const where = eq(payments.status, "success");
      const [rows, total] = await Promise.all([
        tx.select({ p: payments, number: invoices.number, c: tdsCertificates }).from(payments)
          .leftJoin(invoices, eq(invoices.id, payments.invoiceId)).leftJoin(tdsCertificates, eq(tdsCertificates.paymentId, payments.id))
          .where(where).orderBy(desc(payments.paidAt), asc(payments.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(payments).where(where),
      ]);
      return toPage(rows.map(({ p, number, c }) => ({
        id: p.id, invoiceId: p.invoiceId, invoiceNumber: number, amountPaise: p.amountPaise, tdsPaise: p.tdsPaise, method: p.method, reference: p.reference, paidAt: p.paidAt,
        certificate: c ? { id: c.id, status: c.status, quarter: c.quarter, note: c.note, fileName: c.fileName } : null,
      })), Number(total[0]?.n ?? 0), q);
    });
  }

  async listCreditNotes(query: ListQuery = {}): Promise<Page<CreditNoteView>> {
    const q = listQuerySchema.parse(query);
    return this.read("read", async (tx) => {
      const [rows, total] = await Promise.all([
        tx.select({ n: creditNotes, number: invoices.number }).from(creditNotes).innerJoin(invoices, eq(invoices.id, creditNotes.invoiceId))
          .orderBy(desc(creditNotes.createdAt), asc(creditNotes.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(creditNotes),
      ]);
      return toPage(rows.map(({ n, number }) => ({ id: n.id, number: n.number, invoiceId: n.invoiceId, invoiceNumber: number, kind: n.kind, reason: n.reason, totalPaise: n.totalPaise, settlement: n.settlement, refundedAt: n.refundedAt, createdAt: n.createdAt })), Number(total[0]?.n ?? 0), q);
    });
  }

  /** The credit list, newest first, and the balance the next invoice will draw on. */
  async credits() {
    return this.read("read", async (tx) => {
      const rows = await tx.select({ c: accountCredits, number: invoices.number }).from(accountCredits).leftJoin(invoices, eq(invoices.id, accountCredits.invoiceId))
        .orderBy(desc(accountCredits.createdAt), asc(accountCredits.id)).limit(100);
      return { balancePaise: await AccountCredits.balance(tx, this.ctx.schoolId), rows: rows.map(({ c, number }) => ({ id: c.id, at: c.createdAt, kind: c.kind, amountPaise: c.amountPaise, invoiceNumber: number })) };
    });
  }

  async statement(period: { from: string; to: string }): Promise<Statement> {
    return this.read("read", (tx) => loadStatement(tx, this.ctx.schoolId, period.from, period.to));
  }

  async statementPdf(period: { from: string; to: string }): Promise<{ filename: string; bytes: Uint8Array }> {
    return this.read("read", async (tx) => {
      const [school] = await tx.select().from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
      if (!school) throw new NotFoundError("School");
      return { filename: `statement-${period.from}-to-${period.to}.pdf`, bytes: await StatementPdf.render(school, await loadStatement(tx, this.ctx.schoolId, period.from, period.to)) };
    });
  }

  async creditNotePdf(id: string): Promise<{ filename: string; bytes: Uint8Array }> {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("Credit note");
    return this.read("read", (tx) => CreditNotes.pdf(tx, id));
  }

  // ---------- TDS certificates ----------

  async tdsCertificates() {
    return this.read("read", async (tx) => {
      const rows = await tx.select({ c: tdsCertificates, number: invoices.number }).from(tdsCertificates).innerJoin(invoices, eq(invoices.id, tdsCertificates.invoiceId)).orderBy(desc(tdsCertificates.createdAt), asc(tdsCertificates.id));
      return rows.map(({ c, number }) => ({ id: c.id, invoiceNumber: number, amountPaise: c.amountPaise, quarter: c.quarter, status: c.status, note: c.note, fileName: c.fileName }));
    });
  }

  /** Same rule as paying: a read-only school may still send its certificate. */
  async uploadTdsCertificate(certId: string, file: UploadedFile) {
    this.authorize("manage", "read");
    await PlatformBilling.forAdmin(this.ctx).tds().upload(certId, file);
    await withSchool(this.ctx.schoolId, (tx) => this.audit(tx, { action: "tds_certificate_uploaded", entity: "TdsCertificate", entityId: certId, summary: `Uploaded TDS certificate ${file.name}` }));
  }

  async tdsFileUrl(certId: string): Promise<string> {
    if (!z.uuid().safeParse(certId).success) throw new NotFoundError("Certificate");
    return this.read("read", async (tx) => {
      const [c] = await tx.select({ key: tdsCertificates.fileKey }).from(tdsCertificates).where(eq(tdsCertificates.id, certId)).limit(1);
      if (!c?.key) throw new NotFoundError("Certificate file");
      return services().storage.signedUrl(c.key, 300);
    });
  }
}
