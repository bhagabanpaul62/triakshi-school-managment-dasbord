import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { autoRenewEnabled } from "@smw/config";
import { and, closeDb, creditNotes, eq, financialYear, invoices, payments, plans, schools, sql, subscriptions, tdsCertificates, withConsole, withSchool, accountCredits } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createTestSchool, type TestSchool } from "@smw/feature-kit/testing";
import { FakePaymentGateway, MemoryEmailSender, MemoryStorage, useServices } from "@smw/integrations";
import {
  AccountCredits, BillingService, ConsoleBillingService, CreditNoteNumberer, CreditNoteService, OfflinePaymentService, PlatformBilling, TdsReminders, TdsService,
  buildStatement, dueOf, maxTds, splitCredit, tdsQuarter,
} from "./index";

const fake = new FakePaymentGateway();
const mail = new MemoryEmailSender();
const storage = new MemoryStorage();
const staff = (role: "owner" | "support" | "sales") => ({ staffId: "00000000-0000-0000-0000-0000000000bb", role, name: role });
const owner = staff("owner"), support = staff("support"), sales = staff("sales");
const BASIC = 1_180_000; // Basic annual, 1,000,000 + 18% GST
let n = 0;

async function newSchool(state = "Karnataka") {
  const s = await createTestSchool(`mf${++n}`, ["billing"]);
  await withConsole((tx) => tx.update(schools).set({ state, status: "trial", email: `${s.slug}@school.test` }).where(eq(schools.id, s.id)));
  return s;
}
async function checkout(s: TestSchool, planKey = "mf-basic") {
  const r = await PlatformBilling.forAdmin(s.as.admin).startCheckout({ planKey, interval: "annual" });
  if (r.kind !== "checkout") throw new Error(`expected checkout, got ${r.kind}`);
  return r;
}
async function pay(orderId: string) {
  fake.markPaid(orderId);
  return PlatformBilling.system().confirmOrder(orderId);
}
const paidInvoice = async (s: TestSchool) => { const r = await checkout(s); await pay(r.orderId); return r.invoiceId; };
const getInvoice = async (id: string) => (await withConsole((tx) => tx.select().from(invoices).where(eq(invoices.id, id))))[0]!;
const credit = (id: string) => withConsole((tx) => AccountCredits.balance(tx, id));
const note = (invoiceId: string, extra: Record<string, unknown>) => new CreditNoteService(owner).issue({ invoiceId, kind: "correction", reason: "Billed twice by mistake", ...extra });

beforeAll(async () => {
  useServices({ payments: fake, email: mail, storage });
  await withConsole((tx) => tx.insert(plans).values([
    { key: "mf-basic", name: "MF Basic", studentCap: 300, priceAnnualPaise: 1_000_000, priceMonthlyPaise: 100_000, sortOrder: 11 },
    { key: "mf-plus", name: "MF Plus", studentCap: 900, priceAnnualPaise: 2_500_000, priceMonthlyPaise: 250_000, sortOrder: 12 },
  ]));
});
afterAll(async () => {
  // Leave no awaited certificate behind for the lifecycle suite, which mails every school that has one due.
  await withConsole((tx) => tx.update(tdsCertificates).set({ remindedAt: new Date() }));
  await closeDb();
});

describe("credit note maths", () => {
  const inv = { taxablePaise: 1_234_567, cgstPaise: 111_111, sgstPaise: 111_111, igstPaise: 0, totalPaise: 1_456_789 };
  it("every split adds up to the paisa, and notes in a row add up to the invoice", () => {
    let seed = 7;
    const rnd = (max: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) % max) + 1;
    for (let run = 0; run < 300; run++) {
      let left = { ...inv };
      while (left.totalPaise > 0) {
        const amount = run % 3 === 0 ? left.totalPaise : Math.min(left.totalPaise, rnd(900_000));
        const s = splitCredit(left, amount);
        expect(s.taxablePaise + s.cgstPaise + s.sgstPaise + s.igstPaise).toBe(amount);
        expect(s.taxablePaise).toBeLessThanOrEqual(left.taxablePaise);
        expect(s.cgstPaise).toBeLessThanOrEqual(left.cgstPaise);
        expect(s.sgstPaise).toBeLessThanOrEqual(left.sgstPaise);
        left = { taxablePaise: left.taxablePaise - s.taxablePaise, cgstPaise: left.cgstPaise - s.cgstPaise, sgstPaise: left.sgstPaise - s.sgstPaise, igstPaise: 0, totalPaise: left.totalPaise - amount };
      }
      expect(left).toEqual({ taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0 });
    }
  });
  it("refuses zero, fractions and more than is left", () => {
    expect(() => splitCredit(inv, 0)).toThrow(RangeError);
    expect(() => splitCredit(inv, 10.5)).toThrow(RangeError);
    expect(() => splitCredit(inv, inv.totalPaise + 1)).toThrow(RangeError);
  });
  it("TDS limit is 10% and the quarter reminder is 45 days after the quarter", () => {
    expect(maxTds(1_180_000)).toBe(118_000);
    expect(tdsQuarter("2026-08-10")).toEqual({ label: "2026-27 Q2", remindOn: "2026-11-14" });
    expect(tdsQuarter("2027-01-10")).toEqual({ label: "2026-27 Q4", remindOn: "2027-05-15" });
    expect(tdsQuarter("2026-04-01").label).toBe("2026-27 Q1");
  });
  it("auto-renew stays hidden unless CASHFREE_SUBSCRIPTIONS is true", () => {
    expect(autoRenewEnabled()).toBe(false);
  });
});

describe("financial year and numbering", () => {
  it("1 April 00:30 IST on a UTC server is the new year; 23:59 on 31 March is the old", () => {
    expect(financialYear(new Date("2027-03-31T19:00:00Z"))).toBe("2027-28");
    expect(financialYear(new Date("2027-03-31T18:29:00Z"))).toBe("2026-27");
    expect(financialYear(new Date("2027-04-01T00:00:00+05:30"))).toBe("2027-28");
  });
  it("credit notes run in their own gap-free series", async () => {
    const c = new CreditNoteNumberer();
    const a = await withConsole((tx) => c.next(tx, new Date("2036-05-01T00:00:00Z")));
    const b = await withConsole((tx) => c.next(tx, new Date("2036-06-01T00:00:00Z")));
    const next = await withConsole((tx) => c.next(tx, new Date("2037-03-31T19:00:00Z")));
    expect(a.number).toBe("TRK/CN/2036-37/00001");
    expect(b.number).toBe("TRK/CN/2036-37/00002");
    expect(next.number).toBe("TRK/CN/2037-38/00001");
  });
});

describe("credit notes", () => {
  it("a part credit note on an unpaid invoice lowers what is due, splits GST exactly, and is mailed", async () => {
    const s = await newSchool();
    const r = await checkout(s);
    const sent = mail.sent.length;
    const cn = await note(r.invoiceId, { amountPaise: 118_000 });
    expect(cn).toMatchObject({ taxablePaise: 100_000, cgstPaise: 9_000, sgstPaise: 9_000, igstPaise: 0, totalPaise: 118_000, settlement: "adjusted", status: "issued" });
    expect(cn.number).toMatch(/^TRK\/CN\/\d{4}-\d{2}\/\d{5}$/);
    const inv = await getInvoice(r.invoiceId);
    expect(inv).toMatchObject({ status: "issued", totalPaise: BASIC, creditedPaise: 118_000 });
    expect(dueOf(inv)).toBe(1_062_000);
    expect(mail.sent.length).toBe(sent + 1);
    expect(mail.sent.at(-1)!.attachments?.[0]?.filename).toMatch(/^TRK-CN-.*\.pdf$/);
    expect((await withConsole((tx) => tx.select().from(creditNotes).where(eq(creditNotes.id, cn.id))))[0]!.emailedAt).not.toBeNull();

    // The offline payment must now match the lower amount due.
    const off = new OfflinePaymentService(owner);
    await expect(off.record({ invoiceId: r.invoiceId, amountPaise: BASIC, method: "bank_transfer" })).rejects.toBeInstanceOf(ValidationError);
    await off.record({ invoiceId: r.invoiceId, amountPaise: 1_062_000, method: "bank_transfer" });
    expect((await getInvoice(r.invoiceId)).status).toBe("paid");
  });

  it("an IGST invoice splits into IGST only, and the last note takes exactly what is left", async () => {
    const s = await newSchool("Maharashtra");
    const id = await paidInvoice(s);
    const a = await note(id, { amountPaise: 333_333, settle: "credit" });
    const b = await note(id, { amountPaise: BASIC - 333_333, settle: "credit" });
    expect(a.cgstPaise + a.sgstPaise + b.cgstPaise + b.sgstPaise).toBe(0);
    expect(a.taxablePaise + b.taxablePaise).toBe(1_000_000);
    expect(a.igstPaise + b.igstPaise).toBe(180_000);
    await expect(note(id, { amountPaise: 1, settle: "credit" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("is capped at what is left, and a note on a paid invoice must say where the money goes", async () => {
    const s = await newSchool();
    const id = await paidInvoice(s);
    await expect(note(id, { amountPaise: BASIC + 1, settle: "credit" })).rejects.toBeInstanceOf(ValidationError);
    await expect(note(id, { amountPaise: 1000 })).rejects.toBeInstanceOf(ValidationError); // no refund or credit chosen
    await note(id, { amountPaise: BASIC - 100, settle: "credit" });
    await expect(note(id, { amountPaise: 101, settle: "credit" })).rejects.toBeInstanceOf(ValidationError); // only 100 left
  });

  it("cancelling an unpaid invoice is a full credit note, the invoice is void, and a late payment becomes credit", async () => {
    const s = await newSchool();
    const r = await checkout(s);
    const cn = await new CreditNoteService(support).cancelInvoice({ invoiceId: r.invoiceId, reason: "Wrong plan chosen" });
    expect(cn.totalPaise).toBe(BASIC);
    expect(await getInvoice(r.invoiceId)).toMatchObject({ status: "void", creditedPaise: BASIC });
    const [sub] = await withConsole((tx) => tx.select().from(subscriptions).where(eq(subscriptions.schoolId, s.id)));
    expect(sub!.status).toBe("cancelled");
    await expect(new CreditNoteService(support).cancelInvoice({ invoiceId: r.invoiceId, reason: "again please" })).rejects.toBeInstanceOf(ConflictError);

    // The school had already started paying: confirming must not activate anything.
    fake.markPaid(r.orderId);
    const done = await PlatformBilling.system().confirmOrder(r.orderId);
    expect(done).toMatchObject({ state: "paid", creditedPaise: BASIC });
    await PlatformBilling.system().confirmOrder(r.orderId); // replay
    expect((await withConsole((tx) => tx.select().from(schools).where(eq(schools.id, s.id))))[0]).toMatchObject({ planId: null, status: "trial" });
    expect(await credit(s.id)).toBe(BASIC);
    expect(await getInvoice(r.invoiceId)).toMatchObject({ status: "void" });
  });

  it("a paid invoice cannot be cancelled, only credited", async () => {
    const s = await newSchool();
    const id = await paidInvoice(s);
    await expect(new CreditNoteService(owner).cancelInvoice({ invoiceId: id, reason: "no longer needed" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("only owner and support issue; sales and unknown invoices are refused", async () => {
    const s = await newSchool();
    const r = await checkout(s);
    await expect(new CreditNoteService(sales).issue({ invoiceId: r.invoiceId, amountPaise: 1000, kind: "correction", reason: "typo in name" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new CreditNoteService(owner).issue({ invoiceId: "00000000-0000-4000-8000-000000000000", amountPaise: 1000, kind: "correction", reason: "typo in name" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new CreditNoteService(owner).issue({ invoiceId: r.invoiceId, amountPaise: 1000, kind: "correction", reason: "" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("refunds", () => {
  it("are recorded by hand against a credit note, once, by the owner", async () => {
    const s = await newSchool();
    const id = await paidInvoice(s);
    const cn = await note(id, { amountPaise: 118_000, kind: "refund" });
    expect(cn).toMatchObject({ settlement: "refund", refundedAt: null });
    expect(await credit(s.id)).toBe(0);

    const list = await new CreditNoteService(support).list({ filters: { refund: "due", schoolId: s.id } });
    expect(list.rows.map((r) => r.id)).toEqual([cn.id]);
    await expect(new CreditNoteService(support).recordRefund({ creditNoteId: cn.id, method: "bank_transfer" })).rejects.toBeInstanceOf(ForbiddenError);
    await new CreditNoteService(owner).recordRefund({ creditNoteId: cn.id, method: "bank_transfer", reference: "UTR-REF-1", paidOn: "2026-11-24" });
    await expect(new CreditNoteService(owner).recordRefund({ creditNoteId: cn.id, method: "cash" })).rejects.toBeInstanceOf(ConflictError);
    const [row] = await withConsole((tx) => tx.select().from(creditNotes).where(eq(creditNotes.id, cn.id)));
    expect(row).toMatchObject({ refundMethod: "bank_transfer", refundReference: "UTR-REF-1", refundedOn: "2026-11-24", refundedBy: owner.staffId });
    expect((await new CreditNoteService(owner).list({ filters: { refund: "due", schoolId: s.id } })).total).toBe(0);
  });

  it("cannot return more cash than came in, and a credit-note settlement is not refundable", async () => {
    const s = await newSchool();
    const r = await checkout(s);
    await new OfflinePaymentService(owner).record({ invoiceId: r.invoiceId, amountPaise: 1_062_000, tdsPaise: 118_000, method: "bank_transfer" });
    await note(r.invoiceId, { amountPaise: 1_062_000, kind: "refund" });
    await expect(note(r.invoiceId, { amountPaise: 1, kind: "refund" })).rejects.toBeInstanceOf(ValidationError); // the other 118,000 was tax withheld, not cash
    await expect(note(r.invoiceId, { amountPaise: 118_000, kind: "correction", settle: "refund" })).rejects.toBeInstanceOf(ValidationError);
    await note(r.invoiceId, { amountPaise: 118_000, kind: "correction", settle: "credit" });
    await expect(new CreditNoteService(owner).recordRefund({ creditNoteId: "00000000-0000-4000-8000-000000000000", method: "cash" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("TDS", () => {
  it("cash plus tax withheld settles the invoice; more than 10% or a wrong sum is refused", async () => {
    const s = await newSchool();
    const r = await checkout(s);
    const off = new OfflinePaymentService(owner);
    await expect(off.record({ invoiceId: r.invoiceId, amountPaise: 1_000_000, tdsPaise: 180_000, method: "bank_transfer" })).rejects.toMatchObject({ fieldErrors: { tdsPaise: expect.any(String) } });
    await expect(off.record({ invoiceId: r.invoiceId, amountPaise: 1_000_000, tdsPaise: 100_000, method: "bank_transfer" })).rejects.toBeInstanceOf(ValidationError); // adds to 1,100,000
    await expect(off.record({ invoiceId: r.invoiceId, amountPaise: 1_062_000, tdsPaise: 118_001, method: "bank_transfer" })).rejects.toBeInstanceOf(ValidationError);
    expect((await getInvoice(r.invoiceId)).status).toBe("issued");

    await off.record({ invoiceId: r.invoiceId, amountPaise: 1_062_000, tdsPaise: 118_000, method: "bank_transfer", reference: "UTR9", paidOn: "2026-08-10" });
    expect(await getInvoice(r.invoiceId)).toMatchObject({ status: "paid", tdsPaise: 118_000 });
    const [pay] = await withConsole((tx) => tx.select().from(payments).where(and(eq(payments.invoiceId, r.invoiceId), eq(payments.status, "success"))));
    expect(pay).toMatchObject({ amountPaise: 1_062_000, tdsPaise: 118_000 });
    expect((await withConsole((tx) => tx.select().from(schools).where(eq(schools.id, s.id))))[0]!.status).toBe("active");
    const [cert] = await withConsole((tx) => tx.select().from(tdsCertificates).where(eq(tdsCertificates.invoiceId, r.invoiceId)));
    expect(cert).toMatchObject({ status: "awaited", amountPaise: 118_000, quarter: "2026-27 Q2", remindOn: "2026-11-14" });
    const st = await new BillingService(s.as.admin).statement({ from: "2026-01-01", to: "2027-12-31" });
    expect(st.closingPaise).toBe(0);
    expect(st.rows.map((x) => x.kind)).toEqual(expect.arrayContaining(["invoice", "payment", "tds"]));
  });

  it("the school uploads the certificate, staff verify or send it back, and replays do nothing", async () => {
    const s = await newSchool();
    const other = await newSchool();
    const r = await checkout(s);
    await new OfflinePaymentService(owner).record({ invoiceId: r.invoiceId, amountPaise: 1_062_000, tdsPaise: 118_000, method: "bank_transfer", paidOn: "2026-08-10" });
    const svc = new BillingService(s.as.admin);
    const certId = (await svc.listPayments()).rows.find((p) => p.certificate)!.certificate!.id;
    const pdf = { name: "Form16A.pdf", type: "application/pdf", size: 4, bytes: new Uint8Array([37, 80, 68, 70]) };

    await expect(new BillingService(s.as.accountant).uploadTdsCertificate(certId, pdf)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new BillingService(other.as.admin).uploadTdsCertificate(certId, pdf)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.uploadTdsCertificate(certId, { ...pdf, type: "application/x-msdownload" })).rejects.toBeInstanceOf(ValidationError);
    await new TdsService(owner).verify(certId).then(() => { throw new Error("should not verify an empty certificate"); }, (e) => expect(e).toBeInstanceOf(ConflictError));

    await svc.uploadTdsCertificate(certId, pdf);
    const [c1] = await withConsole((tx) => tx.select().from(tdsCertificates).where(eq(tdsCertificates.id, certId)));
    expect(c1).toMatchObject({ status: "received", fileName: "Form16A.pdf" });
    expect(c1!.fileKey!.startsWith(`${s.id}/tds-certificates/`)).toBe(true);
    expect(storage.files.has(c1!.fileKey!)).toBe(true);
    expect(await svc.tdsFileUrl(certId)).toContain(c1!.fileKey);
    await expect(new BillingService(other.as.admin).tdsFileUrl(certId)).rejects.toBeInstanceOf(NotFoundError);

    await expect(new TdsService(support).verify(certId)).rejects.toBeInstanceOf(ForbiddenError);
    await new TdsService(owner).sendBack(certId, "The certificate is for the wrong quarter");
    expect(storage.files.has(c1!.fileKey!)).toBe(false);
    expect((await svc.listPayments()).rows.find((p) => p.certificate)!.certificate).toMatchObject({ status: "awaited", note: "The certificate is for the wrong quarter" });

    await svc.uploadTdsCertificate(certId, pdf);
    await new TdsService(sales).verify(certId);
    await expect(new TdsService(sales).verify(certId)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.uploadTdsCertificate(certId, pdf)).rejects.toBeInstanceOf(ConflictError);
    expect((await new TdsService(support).list({ filters: { status: "verified" }, q: s.slug })).total).toBe(1);
  });

  it("the reminder goes out once, 45 days after the quarter, only for certificates still awaited", async () => {
    const s = await newSchool();
    const r = await checkout(s);
    await new OfflinePaymentService(owner).record({ invoiceId: r.invoiceId, amountPaise: 1_062_000, tdsPaise: 118_000, method: "bank_transfer", paidOn: "2026-08-10" });
    const sent = () => mail.sent.filter((m) => m.to === `${s.slug}@school.test`).length;
    expect(await new TdsReminders().run(new Date("2026-11-13T12:00:00Z"))).toBe(0);
    const before = sent();
    expect(await new TdsReminders().run(new Date("2026-11-14T12:00:00Z"))).toBeGreaterThanOrEqual(1);
    expect(sent()).toBe(before + 1);
    expect(await new TdsReminders().run(new Date("2026-11-20T12:00:00Z"))).toBe(0);
    expect(sent()).toBe(before + 1);
  });
});

describe("account credit", () => {
  it("a second payment for a paid invoice becomes credit once, even when replayed", async () => {
    const s = await newSchool();
    const svc = new BillingService(s.as.admin);
    const r = await checkout(s);
    const second = await svc.payInvoice(r.invoiceId);
    await pay(r.orderId);
    expect(await pay(second.orderId)).toMatchObject({ state: "paid", creditedPaise: BASIC });
    await pay(second.orderId);
    expect(await credit(s.id)).toBe(BASIC);
    expect((await svc.credits()).rows.map((x) => x.kind)).toEqual(["second_payment"]);
    expect((await svc.statement({ from: "2000-01-01", to: "2100-01-01" })).closingPaise).toBe(-BASIC);
  });

  it("the next invoice uses it: the total stays, the amount due is lower, and full cover is paid without a payment", async () => {
    const s = await newSchool();
    const svc = new BillingService(s.as.admin);
    await note(await paidInvoice(s), { amountPaise: 500_000, kind: "goodwill" });
    const r = await checkout(s);
    expect(r.amountPaise).toBe(BASIC - 500_000);
    expect(await getInvoice(r.invoiceId)).toMatchObject({ totalPaise: BASIC, creditAppliedPaise: 500_000 });
    expect(await credit(s.id)).toBe(0);
    expect((await svc.owing()).duePaise).toBe(BASIC - 500_000);
    expect((await svc.owing()).invoices[0]!.duePaise).toBe(BASIC - 500_000);
    await pay(r.orderId);
    expect(await getInvoice(r.invoiceId)).toMatchObject({ status: "paid" });
    const st = await svc.statement({ from: "2000-01-01", to: "2100-01-01" });
    expect(st.closingPaise).toBe(0);
    expect(st.rows.some((x) => x.kind === "credit_used")).toBe(true);

    const f = await newSchool();
    const fid = await paidInvoice(f);
    await note(fid, { amountPaise: BASIC, kind: "goodwill" }); // goodwill on a paid invoice becomes credit
    expect(await credit(f.id)).toBe(BASIC);
    const covered = await PlatformBilling.forAdmin(f.as.admin).startCheckout({ planKey: "mf-basic", interval: "annual" });
    expect(covered.kind).toBe("paid");
    const [inv] = await withConsole((tx) => tx.select().from(invoices).where(and(eq(invoices.schoolId, f.id), eq(invoices.creditAppliedPaise, BASIC))));
    expect(inv).toMatchObject({ status: "paid", totalPaise: BASIC });
    expect(await credit(f.id)).toBe(0);
    expect((await withConsole((tx) => tx.select().from(payments).where(eq(payments.invoiceId, inv!.id)))).length).toBe(0);
    expect((await withConsole((tx) => tx.select().from(subscriptions).where(and(eq(subscriptions.schoolId, f.id), eq(subscriptions.status, "active"))))).length).toBe(1);
  });

  it("two invoices issued at once cannot spend the same credit", async () => {
    const s = await newSchool();
    await withConsole((tx) => AccountCredits.add(tx, { schoolId: s.id, amountPaise: 700_000, kind: "credit_note", sourceKey: `race:${s.id}` }));
    const billing = PlatformBilling.forAdmin(s.as.admin);
    const [x, y] = await Promise.all([billing.startCheckout({ planKey: "mf-basic", interval: "annual" }), billing.startCheckout({ planKey: "mf-plus", interval: "annual" })]);
    expect([x.kind, y.kind]).toEqual(["checkout", "checkout"]);
    const used = await withConsole((tx) => tx.select({ n: sql<number>`coalesce(sum(${accountCredits.amountPaise}), 0)::int` }).from(accountCredits).where(and(eq(accountCredits.schoolId, s.id), eq(accountCredits.kind, "used"))));
    expect(Number(used[0]!.n)).toBe(-700_000);
    expect(await credit(s.id)).toBe(0);
  });

  it("replaying the same credit source adds it once", async () => {
    const s = await newSchool();
    const add = () => withConsole((tx) => AccountCredits.add(tx, { schoolId: s.id, amountPaise: 1_000, kind: "credit_note", sourceKey: "same" }));
    expect([await add(), await add()]).toEqual([true, false]);
    expect(await credit(s.id)).toBe(1_000);
  });
});

describe("what a school may see and write", () => {
  it("sees only its own notes, credits, payments and statement; cannot fetch another school's note PDF", async () => {
    const a = await newSchool(), b = await newSchool();
    const id = await paidInvoice(a);
    const cn = await note(id, { amountPaise: 50_000, settle: "credit" });
    const aSvc = new BillingService(a.as.admin), bSvc = new BillingService(b.as.accountant);
    expect((await aSvc.listCreditNotes()).rows.map((r) => r.id)).toEqual([cn.id]);
    expect((await bSvc.listCreditNotes()).total).toBe(0);
    expect((await bSvc.credits()).balancePaise).toBe(0);
    expect((await bSvc.listPayments()).total).toBe(0);
    expect((await bSvc.statement({ from: "2000-01-01", to: "2100-01-01" })).rows).toEqual([]);
    const pdf = await aSvc.creditNotePdf(cn.id);
    expect(Buffer.from(pdf.bytes.slice(0, 5)).toString()).toBe("%PDF-");
    await expect(bSvc.creditNotePdf(cn.id)).rejects.toBeInstanceOf(NotFoundError);
    const st = await aSvc.statementPdf({ from: "2000-01-01", to: "2100-01-01" });
    expect(Buffer.from(st.bytes.slice(0, 5)).toString()).toBe("%PDF-");
    await expect(new BillingService(a.as.teacher).credits()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the school database role cannot write the console's billing tables", async () => {
    const a = await newSchool();
    const id = await paidInvoice(a);
    const cn = await note(id, { amountPaise: 50_000, settle: "credit" });
    const fresh = { schoolId: a.id, invoiceId: id };
    await expect(withSchool(a.id, (tx) => tx.insert(creditNotes).values({ ...fresh, number: "X/1", financialYear: "2026-27", kind: "goodwill", reason: "x", taxablePaise: 1, totalPaise: 1, settlement: "credit" }))).rejects.toThrow();
    await expect(withSchool(a.id, (tx) => tx.update(creditNotes).set({ totalPaise: 1 }).where(eq(creditNotes.id, cn.id)))).rejects.toThrow();
    await expect(withSchool(a.id, (tx) => tx.insert(accountCredits).values({ schoolId: a.id, amountPaise: 99_999_999, kind: "credit_note", sourceKey: "mine" }))).rejects.toThrow();
    await expect(withSchool(a.id, (tx) => tx.update(tdsCertificates).set({ status: "verified" }))).rejects.toThrow();
    await expect(withSchool(a.id, (tx) => tx.update(invoices).set({ tdsPaise: 5 }).where(eq(invoices.id, id)))).rejects.toThrow();
  });
});

describe("console reads", () => {
  it("ageing buckets add up to what is outstanding and each links to its invoices", async () => {
    const s = await newSchool();
    const now = new Date();
    const day = 86_400_000;
    const mk = async (label: string, dueIn: number) => (await withConsole((tx) => tx.insert(invoices).values({
      schoolId: s.id, number: `AGE/${s.slug}/${label}`, financialYear: "2026-27", description: label, taxablePaise: 100_000, totalPaise: 118_000, dueAt: new Date(now.getTime() + dueIn * day),
    }).returning()))[0]!;
    const rows = { cur: await mk("cur", 5), a: await mk("a", -10), b: await mk("b", -45), c: await mk("c", -75), d: await mk("d", -120) };
    const c = new ConsoleBillingService(support);
    const buckets = await c.ageing(now);
    expect(buckets.map((b) => b.key)).toEqual(["current", "1-30", "31-60", "61-90", "90+"]);
    for (const b of buckets) expect(b.paise).toBeGreaterThanOrEqual(118_000);
    expect(buckets.reduce((x, b) => x + b.paise, 0)).toBe((await c.revenue(now)).outstandingPaise);
    const ids = async (age: string) => (await c.invoices({ filters: { age, schoolId: s.id }, pageSize: 100 }, now)).rows.map((r) => r.id);
    expect(await ids("1-30")).toEqual([rows.a.id]);
    expect(await ids("31-60")).toEqual([rows.b.id]);
    expect(await ids("61-90")).toEqual([rows.c.id]);
    expect(await ids("90+")).toEqual([rows.d.id]);
    expect(await ids("current")).toEqual([rows.cur.id]);
  });

  it("payment history per school and the invoice page carry TDS, notes and what is due", async () => {
    const s = await newSchool();
    const r = await checkout(s);
    await new OfflinePaymentService(owner).record({ invoiceId: r.invoiceId, amountPaise: 1_062_000, tdsPaise: 118_000, method: "upi", reference: "UPI1" });
    const c = new ConsoleBillingService(support);
    const hist = await c.payments({ filters: { schoolId: s.id } });
    expect(hist.rows).toHaveLength(1);
    expect(hist.rows[0]).toMatchObject({ amountPaise: 1_062_000, tdsPaise: 118_000, schoolName: `School ${s.slug.toUpperCase()}` });
    const detail = await c.invoice(r.invoiceId);
    expect(detail).toMatchObject({ duePaise: 0, payments: [{ reference: "UPI1" }], certificates: [{ status: "awaited" }] });
    const acct = await c.schoolAccount(s.id);
    expect(acct.statement.closingPaise).toBe(0);
  });
});

describe("statement maths", () => {
  const d = (s: string) => new Date(`${s}T10:00:00+05:30`);
  it("keeps a running balance, carries the opening balance in, and shows credit as negative", () => {
    const events = [
      { at: d("2026-04-02"), kind: "invoice" as const, ref: "I1", text: "Plan", amountPaise: 1000 },
      { at: d("2026-04-10"), kind: "payment" as const, ref: "I1", text: "Paid", amountPaise: -1200 },
      { at: d("2026-05-01"), kind: "invoice" as const, ref: "I2", text: "Plan", amountPaise: 500 },
    ];
    const all = buildStatement(events, "2026-04-01", "2026-12-31");
    expect(all.rows.map((r) => r.balancePaise)).toEqual([1000, -200, 300]);
    const may = buildStatement(events, "2026-05-01", "2026-12-31");
    expect(may).toMatchObject({ openingPaise: -200, closingPaise: 300, debitPaise: 500, creditPaise: 0 });
    expect(buildStatement(events, "2026-04-01", "2026-04-30").closingPaise).toBe(-200);
  });
});
