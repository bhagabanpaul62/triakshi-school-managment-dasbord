import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, closeDb, eq, invoices, payments, plans, schools, subscriptions, webhookEvents, withConsole } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, createTestSchool, type TestSchool } from "@smw/feature-kit/testing";
import { FakePaymentGateway, MemoryEmailSender, useServices } from "@smw/integrations";
import {
  BillingService, ConsoleBillingService, InvoiceNumberer, OfflinePaymentService, PlatformBilling, ProrationCalculator, WebhookProcessor,
} from "./index";

let a: TestSchool, b: TestSchool;
const fake = new FakePaymentGateway();
const STARTER_YEAR = 1_000_000, GROWTH_YEAR = 2_500_000;

async function paid(svc: BillingService, input: { planKey: string; interval: "annual" | "monthly" }) {
  const r = await svc.startCheckout(input);
  if (r.kind !== "checkout") throw new Error("expected checkout");
  fake.markPaid(r.orderId);
  await svc.confirmOrder(r.orderId);
  return r;
}

beforeAll(async () => {
  useServices({ payments: fake, email: new MemoryEmailSender() });
  ({ a, b } = await createSchoolPair(["billing"]));
  await withConsole(async (tx) => {
    await tx.insert(plans).values([
      { key: "starter", name: "Starter", studentCap: 300, priceAnnualPaise: STARTER_YEAR, priceMonthlyPaise: 100_000, sortOrder: 1 },
      { key: "growth", name: "Growth", studentCap: 1000, priceAnnualPaise: GROWTH_YEAR, priceMonthlyPaise: 250_000, sortOrder: 2 },
    ]);
    await tx.update(schools).set({ state: "Karnataka", status: "trial", trialEndsAt: new Date(Date.now() + 5 * 86_400_000) }).where(eq(schools.id, a.id));
    await tx.update(schools).set({ state: "Maharashtra", status: "trial" }).where(eq(schools.id, b.id));
  });
});
afterAll(closeDb);

describe("checkout and confirmation", () => {
  it("only the school admin can start a checkout", async () => {
    await expect(new BillingService(a.as.accountant).startCheckout({ planKey: "starter", interval: "annual" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new BillingService(a.as.teacher).overview()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new BillingService(a.as.accountant).overview()).resolves.toMatchObject({ plan: null });
  });

  it("checkout issues a GST invoice (CGST+SGST in our state), confirm activates the plan once", async () => {
    const svc = new BillingService(a.as.admin);
    const r = await svc.startCheckout({ planKey: "starter", interval: "annual" });
    expect(r.kind).toBe("checkout");
    if (r.kind !== "checkout") return;
    expect(r.amountPaise).toBe(1_180_000);

    // Redirect without payment: still pending, nothing changes.
    expect((await svc.confirmOrder(r.orderId)).state).toBe("pending");
    expect((await svc.overview()).plan).toBeNull();

    fake.markPaid(r.orderId);
    expect((await svc.confirmOrder(r.orderId)).state).toBe("paid");
    expect((await svc.confirmOrder(r.orderId)).state).toBe("paid"); // idempotent

    const inv = (await svc.listInvoices()).rows[0]!;
    expect(inv).toMatchObject({ status: "paid", taxablePaise: STARTER_YEAR, cgstPaise: 90_000, sgstPaise: 90_000, igstPaise: 0, totalPaise: 1_180_000 });
    expect(inv.number).toMatch(/^TRK\/\d{4}-\d{2}\/\d{5}$/);

    const o = await svc.overview();
    expect(o).toMatchObject({ school: { status: "active", trialEndsAt: null }, plan: { key: "starter", studentCap: 300 }, cap: 300, subscription: { interval: "annual", status: "active" } });
    expect(o.daysLeft).toBeGreaterThan(360);
    const pays = await withConsole((tx) => tx.select().from(payments).where(and(eq(payments.schoolId, a.id), eq(payments.status, "success"))));
    expect(pays).toHaveLength(1);
    expect(pays[0]!.gatewayPaymentId).toBe(`fakepay_${r.orderId}`);
  });

  it("another state pays IGST; invoice numbers run on without gaps", async () => {
    const svc = new BillingService(b.as.admin);
    const r = await paid(svc, { planKey: "starter", interval: "annual" });
    const inv = (await svc.listInvoices()).rows[0]!;
    expect(inv).toMatchObject({ igstPaise: 180_000, cgstPaise: 0, sgstPaise: 0 });
    const aNum = (await new BillingService(a.as.admin).listInvoices()).rows[0]!.number;
    expect(Number(inv.number.split("/")[2])).toBe(Number(aNum.split("/")[2]) + 1);
    expect(r.invoiceId).toBe(inv.id);
  });

  it("numbering restarts each financial year", async () => {
    const n = new InvoiceNumberer();
    const x = await withConsole((tx) => n.next(tx, new Date("2031-05-01T00:00:00Z")));
    const y = await withConsole((tx) => n.next(tx, new Date("2032-02-01T00:00:00Z")));
    const z = await withConsole((tx) => n.next(tx, new Date("2032-04-02T00:00:00Z")));
    expect(x).toEqual({ number: "TRK/2031-32/00001", financialYear: "2031-32" });
    expect(y.number).toBe("TRK/2031-32/00002");
    expect(z.number).toBe("TRK/2032-33/00001");
  });

  it("a school cannot confirm, pay or download another school's order or invoice", async () => {
    const aSvc = new BillingService(a.as.admin);
    const r = await aSvc.startCheckout({ planKey: "starter", interval: "annual" }); // renewal invoice, unpaid
    if (r.kind !== "checkout") throw new Error();
    const bSvc = new BillingService(b.as.admin);
    await expect(bSvc.confirmOrder(r.orderId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.payInvoice(r.invoiceId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.invoicePdf(r.invoiceId)).rejects.toBeInstanceOf(NotFoundError);
    expect((await bSvc.listInvoices()).rows.some((i) => i.id === r.invoiceId)).toBe(false);
  });

  it("forAdmin refuses anyone but an admin", () => {
    expect(() => PlatformBilling.forAdmin(a.as.accountant)).toThrow(ForbiddenError);
  });

  it("Pay now makes a fresh order for an issued invoice and refuses a paid one", async () => {
    const svc = new BillingService(a.as.admin);
    const unpaid = (await svc.listInvoices({ filters: { status: "issued" } })).rows[0]!;
    const r = await svc.payInvoice(unpaid.id);
    expect(r.amountPaise).toBe(unpaid.totalPaise);
    fake.markPaid(r.orderId);
    await svc.confirmOrder(r.orderId);
    await expect(svc.payInvoice(unpaid.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("renewal starts when the paid period ends", async () => {
    const [subs] = await Promise.all([withConsole((tx) => tx.select().from(subscriptions).where(and(eq(subscriptions.schoolId, a.id), eq(subscriptions.status, "active"))))]);
    expect(subs).toHaveLength(1);
    const active = subs[0]!;
    const first = await withConsole((tx) => tx.select().from(subscriptions).where(eq(subscriptions.schoolId, a.id)));
    const starts = first.map((s) => s.currentPeriodStart!.getTime()).sort((x, y) => x - y);
    expect(active.currentPeriodStart!.getTime()).toBe(starts[1]); // second period begins where the first ended
    expect(active.currentPeriodStart!.getTime()).toBeGreaterThan(Date.now() + 300 * 86_400_000);
  });

  it("invoice PDF renders", async () => {
    const svc = new BillingService(a.as.admin);
    const inv = (await svc.listInvoices()).rows[0]!;
    const pdf = await svc.invoicePdf(inv.id);
    expect(pdf.filename).toMatch(/^TRK-.*\.pdf$/);
    expect(Buffer.from(pdf.bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });
});

describe("upgrade and downgrade", () => {
  it("upgrade charges the prorated difference and replaces the plan", async () => {
    const { a: c } = await createSchoolPair(["billing"], "up");
    await withConsole((tx) => tx.update(schools).set({ state: "Karnataka" }).where(eq(schools.id, c.id)));
    const svc = new BillingService(c.as.admin);
    await paid(svc, { planKey: "starter", interval: "annual" });
    const [sub] = await withConsole((tx) => tx.select().from(subscriptions).where(eq(subscriptions.schoolId, c.id)));
    const now = new Date(sub!.currentPeriodStart!.getTime() + 100 * 86_400_000);
    const expected = ProrationCalculator.quote({ oldPaise: STARTER_YEAR, newPaise: GROWTH_YEAR, periodStart: sub!.currentPeriodStart!, periodEnd: sub!.currentPeriodEnd!, now });
    if (expected.kind !== "upgrade") throw new Error();

    const r = await PlatformBilling.forAdmin(c.as.admin).startCheckout({ planKey: "growth", interval: "annual" }, now);
    if (r.kind !== "checkout") throw new Error("expected checkout");
    const [inv] = await withConsole((tx) => tx.select().from(invoices).where(eq(invoices.id, r.invoiceId)));
    expect(inv!.taxablePaise).toBe(expected.amountPaise);
    expect(inv!.description).toMatch(/Upgrade to Growth/);

    fake.markPaid(r.orderId);
    await svc.confirmOrder(r.orderId);
    const o = await svc.overview();
    expect(o.plan).toMatchObject({ key: "growth", studentCap: 1000 });
    const subs = await withConsole((tx) => tx.select().from(subscriptions).where(eq(subscriptions.schoolId, c.id)));
    const active = subs.filter((s) => s.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0]!.currentPeriodEnd!.getTime()).toBe(sub!.currentPeriodEnd!.getTime()); // upgrade keeps the paid period

    // Downgrade is scheduled, not charged.
    const d = await svc.startCheckout({ planKey: "starter", interval: "annual" });
    expect(d).toMatchObject({ kind: "scheduled", planName: "Starter" });
    expect((await svc.overview()).subscription?.pendingPlanName).toBe("Starter");
    // Interval switch mid-period is refused with a clear message.
    await expect(svc.startCheckout({ planKey: "growth", interval: "monthly" })).rejects.toBeInstanceOf(ValidationError);
    // Renewing on the scheduled plan applies it.
    const renew = await paid(svc, { planKey: "starter", interval: "annual" });
    expect(renew.amountPaise).toBe(1_180_000);
    expect((await svc.overview()).plan?.key).toBe("starter");
  });
});

describe("webhooks", () => {
  it("the same event twice is processed once; unsigned junk is rejected by the gateway adapter", async () => {
    const svc = new BillingService(a.as.admin);
    const r = await svc.startCheckout({ planKey: "starter", interval: "annual" });
    if (r.kind !== "checkout") throw new Error();
    fake.markPaid(r.orderId);
    const body = JSON.stringify({ id: `evt_${r.orderId}`, type: "PAYMENT_SUCCESS_WEBHOOK", orderId: r.orderId });
    const wh = new WebhookProcessor();
    expect(await wh.handle(body, {})).toMatchObject({ status: "processed" });
    expect(await wh.handle(body, {})).toMatchObject({ status: "duplicate" });
    const rows = await withConsole((tx) => tx.select().from(webhookEvents).where(eq(webhookEvents.eventId, `evt_${r.orderId}`)));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.processedAt).not.toBeNull();
    const ok = await withConsole((tx) => tx.select().from(payments).where(and(eq(payments.gatewayOrderId, r.orderId), eq(payments.status, "success"))));
    expect(ok).toHaveLength(1);
    expect(await wh.handle(JSON.stringify({ id: "evt_other", type: "PAYMENT_FAILED_WEBHOOK", orderId: r.orderId }), {})).toMatchObject({ status: "ignored" });
  });

  it("a failed confirmation is not remembered, so the gateway retry runs", async () => {
    const wh = new WebhookProcessor();
    const body = JSON.stringify({ id: "evt_unknown_order", type: "PAYMENT_SUCCESS_WEBHOOK", orderId: "trk_does_not_exist" });
    await expect(wh.handle(body, {})).rejects.toBeInstanceOf(NotFoundError);
    const rows = await withConsole((tx) => tx.select().from(webhookEvents).where(eq(webhookEvents.eventId, "evt_unknown_order")));
    expect(rows).toHaveLength(0);
  });

  it("a paid amount that differs from the invoice is refused", async () => {
    const svc = new BillingService(a.as.admin);
    const r = await svc.startCheckout({ planKey: "starter", interval: "annual" });
    if (r.kind !== "checkout") throw new Error();
    fake.markPaid(r.orderId);
    fake.orders.get(r.orderId)!.amountPaise = 5;
    await expect(svc.confirmOrder(r.orderId)).rejects.toBeInstanceOf(ConflictError);
    const [inv] = await withConsole((tx) => tx.select().from(invoices).where(eq(invoices.id, r.invoiceId)));
    expect(inv!.status).toBe("issued");
  });
});

describe("offline payments and console reads", () => {
  it("staff records a bank transfer against an invoice; it settles like an online payment", async () => {
    const { a: d } = await createSchoolPair(["billing"], "off");
    await withConsole((tx) => tx.update(schools).set({ state: "Goa", status: "trial" }).where(eq(schools.id, d.id)));
    const r = await new BillingService(d.as.admin).startCheckout({ planKey: "starter", interval: "annual" });
    if (r.kind !== "checkout") throw new Error();
    const staff = { staffId: "00000000-0000-0000-0000-0000000000aa", role: "owner" as const, name: "Owner" };
    const svc = new OfflinePaymentService(staff);

    await expect(new OfflinePaymentService({ ...staff, role: "support" }).record({ invoiceId: r.invoiceId, amountPaise: 1_180_000, method: "bank_transfer" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.record({ invoiceId: r.invoiceId, amountPaise: 5_000, method: "bank_transfer" })).rejects.toBeInstanceOf(ValidationError);
    await svc.record({ invoiceId: r.invoiceId, amountPaise: 1_180_000, method: "bank_transfer", reference: "UTR123", paidOn: "2026-05-02" });
    await expect(svc.record({ invoiceId: r.invoiceId, amountPaise: 1_180_000, method: "cheque" })).rejects.toBeInstanceOf(ConflictError);

    const [school] = await withConsole((tx) => tx.select().from(schools).where(eq(schools.id, d.id)));
    expect(school).toMatchObject({ status: "active", studentCap: 300 });
    const [pay] = await withConsole((tx) => tx.select().from(payments).where(and(eq(payments.invoiceId, r.invoiceId), eq(payments.method, "bank_transfer"))));
    expect(pay).toMatchObject({ status: "success", reference: "UTR123", recordedBy: staff.staffId });
  });

  it("console lists invoices across schools with filters, and sums revenue", async () => {
    const staff = { staffId: "00000000-0000-0000-0000-0000000000aa", role: "support" as const, name: "S" };
    const c = new ConsoleBillingService(staff);
    const all = await c.invoices({ pageSize: 100 });
    expect(new Set(all.rows.map((r) => r.schoolId)).size).toBeGreaterThan(2);
    const paidOnly = await c.invoices({ filters: { status: "paid" }, pageSize: 100 });
    expect(paidOnly.rows.every((r) => r.status === "paid")).toBe(true);
    expect((await c.invoices({ q: "School A", pageSize: 100 })).rows.every((r) => r.schoolName.includes("School A"))).toBe(true);
    const overdue = await c.invoices({ filters: { status: "overdue" } }, new Date(Date.now() + 30 * 86_400_000));
    expect(overdue.total).toBeGreaterThan(0);
    const rev = await c.revenue();
    expect(rev.collectedPaise).toBeGreaterThan(0);
    expect(rev.months).toHaveLength(12);
    expect(rev.months.reduce((s, m) => s + m.paise, 0)).toBe(rev.collectedPaise);
    expect(rev.outstandingPaise).toBeGreaterThan(0);
  });

  it("choosing the same plan twice reuses the open invoice", async () => {
    const svc = new BillingService(a.as.admin);
    const x = await svc.startCheckout({ planKey: "growth", interval: "annual" });
    const y = await svc.startCheckout({ planKey: "growth", interval: "annual" });
    expect(x.kind === "checkout" && y.kind === "checkout" && x.invoiceId === y.invoiceId && x.orderId !== y.orderId).toBe(true);
  });

  it("a new purchase retried minutes later still reuses the open invoice (its period end moves with the clock)", async () => {
    const fresh = await createTestSchool("billing-retry", ["billing"]);
    const billing = PlatformBilling.forAdmin(fresh.as.admin);
    const t0 = new Date();
    const x = await billing.startCheckout({ planKey: "starter", interval: "annual" }, t0);
    const y = await billing.startCheckout({ planKey: "starter", interval: "annual" }, new Date(t0.getTime() + 5 * 60_000));
    expect(x.kind === "checkout" && y.kind === "checkout" && x.invoiceId === y.invoiceId).toBe(true);
    const open = await withConsole((tx) => tx.select().from(invoices).where(and(eq(invoices.schoolId, fresh.id), eq(invoices.status, "issued"))));
    expect(open).toHaveLength(1);
  });
});
