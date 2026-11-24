// Findings of the independent review of the fees module. Each test fails without its fix.
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { ConflictError, ValidationError } from "@smw/feature-kit";
import { addDays } from "@smw/feature-kit/money";
import { ApprovalDeskService } from "@smw/feature-finance/services/approval-desk";
import { finAccounts, finApprovals } from "@smw/feature-finance/schema";
import { students } from "@smw/feature-students/schema";
import { feesApprovals } from "./approval-handlers";
import { CertificateService } from "./certificates";
import { ChecksService } from "./checks";
import { ChequeService } from "./cheques";
import { ConcessionService } from "./concessions";
import { CounterService } from "./counter";
import { DuesService } from "./dues";
import { HeadService, PlanService } from "./plans";
import { InvoiceService } from "./invoices";
import { ReceiptService } from "./receipts";
import { RefundService } from "./refunds";
import { SettlementService } from "./settlements";
import { SlipService } from "./slips";
import { feeInvoiceChanges, feeCounters, feeOpeningBatches, feePlans, feeRefunds, feeSettlements } from "./schema";
import { TODAY, bills, config, decide, due, makeSchool, newStudent, openingApproved, type Fixture } from "./testing";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
let fx: Fixture, fx2: Fixture;
const [admin, accountant] = [() => fx.school.as.admin, () => fx.school.as.accountant];
const receipts = () => new ReceiptService(accountant());
const cheques = () => new ChequeService(accountant());
const checks = async () => (await new ChecksService(admin()).run()).mismatches;
const account = (id: string, f = fx) => new DuesService(f.school.as.admin).studentAccount(id);
const upi = (amountPaise: number, reference = "UTR-X") => [{ method: "upi" as const, amountPaise, reference }];
const chequeOf = (amountPaise: number, no: string) => [{ method: "cheque" as const, amountPaise, cheque: { chequeNo: no, bank: "SBI", chequeDate: TODAY } }];
const csv = (rows: string[][]) => ({ name: "opening.csv", bytes: new TextEncoder().encode(["admission_no,dues,advance,deposit,as_of", ...rows.map((r) => r.join(","))].join("\n")) });
const admissionNo = (id: string) => withSchool(fx.school.id, async (tx) => (await tx.select({ n: students.admissionNo }).from(students).where(eq(students.id, id)))[0]!.n);
const pendingApproval = (kind: string, refId: string) => withSchool(fx.school.id, async (tx) => (await tx.select().from(finApprovals).where(and(eq(finApprovals.kind, kind), eq(finApprovals.refId, refId), eq(finApprovals.status, "pending"))))[0]!);

beforeAll(async () => {
  fx = await makeSchool("fixes");
  fx2 = await makeSchool("fixes2");
});
afterAll(closeDb);

describe("cheques and advances", () => {
  it("1: a reversed receipt cancels its cheque, which can then not be deposited, cleared or bounced", async () => {
    const id = await newStudent(fx, "Chq One");
    const r = await receipts().collect({ studentId: id, methods: chequeOf(100_000, "7001") });
    await receipts().requestReversal(r.id, "Wrong cheque");
    await decide(fx, "fees.reversal", r.id);
    const { cheque } = await receipts().get(r.id);
    expect(cheque?.status).toBe("cancelled");
    for (const step of ["deposit", "clear", "bounce"] as const) await expect(cheques()[step]({ id: cheque!.id, reason: "x" })).rejects.toBeInstanceOf(ConflictError);
    expect(await checks()).toEqual([]);
  });

  it("8, 7: the advance of a cheque waits until it clears, is then used on bills, and reversing gives those bills back", async () => {
    const id = await newStudent(fx2, "Chq Two"); // owes M1 and M2: 200,000
    const as = fx2.school.as.accountant;
    const r = await new ReceiptService(as).collect({ studentId: id, methods: chequeOf(300_000, "7002") });
    expect(r.advancePaise).toBe(100_000);
    await expect(new RefundService(as).propose({ studentId: id, source: "advance", amountPaise: 50_000, method: "cash", reason: "Overpaid" })).rejects.toThrow(/Only ₹0/);
    expect((await account(id, fx2)).balance).toMatchObject({ advancePaise: 0, waitingAdvancePaise: 100_000 });
    const { cheque } = await new ReceiptService(as).get(r.id);
    await new ChequeService(as).deposit({ id: cheque!.id });
    await new ChequeService(as).clear({ id: cheque!.id });
    expect((await account(id, fx2)).balance).toMatchObject({ advancePaise: 100_000, waitingAdvancePaise: 0 });
    await new InvoiceService(fx2.school.as.admin).issueBulk({}, addDays(TODAY, 15)); // M3 takes the advance
    expect((await account(id, fx2)).balance).toMatchObject({ advancePaise: 0, openPaise: 0 });
    await new ReceiptService(as).requestReversal(r.id, "Wrong cheque");
    await decide(fx2, "fees.reversal", r.id);
    expect((await account(id, fx2)).balance).toMatchObject({ advancePaise: 0, openPaise: 300_000 });
    expect((await new ChecksService(fx2.school.as.admin).run()).mismatches).toEqual([]);
  });

  it("9: a receipt whose deposit was refunded cannot be reversed, and the message says what to do", async () => {
    const id = await newStudent(fx, "Deposit One", { issue: false });
    const inv = new InvoiceService(accountant());
    const draftId = await inv.saveDraft({ studentId: id, label: "Caution deposit", dueDate: TODAY, lines: [{ headId: fx.heads.deposit, label: "Caution deposit", amountPaise: 200_000 }] });
    await inv.issue(draftId as unknown as string);
    const r = await receipts().collect({ studentId: id, invoiceIds: [draftId as unknown as string], methods: upi(200_000, "UTR-DEP") });
    const refund = await new RefundService(accountant()).propose({ studentId: id, source: "deposit", amountPaise: 150_000, method: "cash", reason: "Left" });
    await decide(fx, "fees.refund", refund.id);
    await receipts().requestReversal(r.id, "Wrong student");
    await expect(decide(fx, "fees.reversal", r.id)).rejects.toThrow(/deposit from this receipt was already refunded or used.*Cancel that refund/);
    expect((await receipts().get(r.id)).receipt.status).toBe("valid");
  });

  it("20: the tuition certificate counts a cheque only once it has cleared", async () => {
    const id = await newStudent(fx, "Cert One");
    const r = await receipts().collect({ studentId: id, methods: chequeOf(100_000, "7003") });
    const certs = new CertificateService(admin());
    expect((await certs.tuition(id)).totalPaise).toBe(0);
    const { cheque } = await receipts().get(r.id);
    await cheques().deposit({ id: cheque!.id });
    await cheques().clear({ id: cheque!.id });
    expect((await certs.tuition(id)).totalPaise).toBe(100_000);
  });
});

describe("limits and approvals", () => {
  it("3: two concessions at once cannot both slip under the limit", async () => {
    await config(fx, { concessionLimitPaise: 150_000 });
    const id = await newStudent(fx, "Race One", { issue: false });
    const svc = new ConcessionService(accountant());
    const out = await Promise.all([1, 2].map((n) => svc.propose({ studentId: id, mode: "amount", per: "year", value: 100_000, reason: `Race ${n}` })));
    expect(out.map((c) => c.status).sort()).toEqual(["approved", "pending"]);
  });

  it("4: a concession that cannot be valued is not small, even at a limit of 0", async () => {
    await config(fx, { concessionLimitPaise: 0 });
    const id = await newStudent(fx, "No Value", { issue: false });
    const c = await new ConcessionService(accountant()).propose({ studentId: id, headId: fx.heads.exam, mode: "percent", value: 5000, reason: "Merit" }); // no plan line for this head
    expect(c.status).toBe("pending");
  });

  it("5: a settlement is refused when the dues moved since it was asked, and one click sends it again", async () => {
    await config(fx, { concessionLimitPaise: 0 });
    const id = await newStudent(fx, "Stale One"); // owes 200,000
    const svc = new SettlementService(accountant());
    const s = await svc.propose({ studentId: id, reason: "Family in hardship", writeOffPaise: 20_000 });
    await receipts().collect({ studentId: id, methods: upi(100_000, "UTR-STALE") });
    await expect(decide(fx, "fees.settlement", s.id)).rejects.toThrow("The dues changed since this was asked. Send it again.");
    await svc.resend(s.id);
    await decide(fx, "fees.settlement", s.id);
    expect((await account(id)).balance.openPaise).toBe(80_000);
  });

  it("5: sending a refused settlement again previews the settlement's own student", async () => {
    const [a, b] = [await newStudent(fx, "Own One"), await newStudent(fx, "Own Two")];
    await receipts().collect({ studentId: b, methods: upi(100_000, "UTR-OWN") }); // b owes less than a
    const svc = new SettlementService(accountant());
    const s = await svc.propose({ studentId: a, reason: "Family in hardship", writeOffPaise: 10_000 });
    await decide(fx, "fees.settlement", s.id, "reject", "Not now");
    await svc.resubmit(s.id, { studentId: b, reason: "Family in hardship", writeOffPaise: 10_000 });
    const [row] = await withSchool(fx.school.id, (tx) => tx.select().from(feeSettlements).where(eq(feeSettlements.id, s.id)));
    expect(row!.studentId).toBe(a);
    expect((row!.plan as { requested: { openBeforePaise: number } }).requested.openBeforePaise).toBe(200_000);
  });

  it("2: withdrawing from the approvals desk frees a refund, a bill change, a plan, an opening sheet and a counter", async () => {
    await config(fx, { concessionLimitPaise: 0, autoUseAdvance: false });
    const desk = new ApprovalDeskService(accountant(), feesApprovals);
    const withdraw = async (kind: string, refId: string) => desk.withdraw((await pendingApproval(kind, refId)).id);

    const refunded = await newStudent(fx, "Desk Refund", { issue: false });
    await openingApproved(fx, csv([[await admissionNo(refunded), "", "100", "", ""]]));
    const refund = await new RefundService(accountant()).propose({ studentId: refunded, source: "advance", amountPaise: 10_000, method: "bank_transfer", reason: "Overpaid" });
    await withdraw("fees.refund", refund.id);
    expect((await withSchool(fx.school.id, (tx) => tx.select().from(feeRefunds).where(eq(feeRefunds.id, refund.id))))[0]!.status).toBe("rejected");

    const billed = await newStudent(fx, "Desk Change");
    const [bill] = await bills(fx, billed);
    const asked = await new InvoiceService(accountant()).cancel(bill!.id, "Billed twice");
    expect(asked.requested).toBe(true);
    await withdraw("fees.invoice_change", asked.changeId!);
    expect((await withSchool(fx.school.id, (tx) => tx.select().from(feeInvoiceChanges).where(eq(feeInvoiceChanges.id, asked.changeId!))))[0]!.status).toBe("rejected");

    const plans = new PlanService(accountant());
    const draft = await plans.saveDraft({ yearId: fx.yearId, name: "Class 6 fees", classIds: [fx.otherClassId], lines: [{ headId: fx.heads.tuition, dues: [due("M1", 10, 90_000)] }] });
    await plans.submit(draft.plan.id);
    await withdraw("fees.plan", draft.plan.id);
    expect((await withSchool(fx.school.id, (tx) => tx.select().from(feePlans).where(eq(feePlans.id, draft.plan.id))))[0]!.status).toBe("draft");

    const sheetFor = await newStudent(fx, "Desk Sheet", { issue: false });
    const sheet = await new InvoiceService(accountant()).importOpening(csv([[await admissionNo(sheetFor), "5000", "", "", ""]]), false);
    await withdraw("fees.opening", sheet.batchId!);
    expect((await withSchool(fx.school.id, (tx) => tx.select().from(feeOpeningBatches).where(eq(feeOpeningBatches.id, sheet.batchId!))))[0]!.status).toBe("rejected");

    const counter = new CounterService(accountant());
    await counter.open({ floatPaise: 100_000 });
    const closed = await counter.close({ countedPaise: 90_000, differenceReason: "Counted by hand" });
    await withdraw("fees.counter_difference", closed.counter.id);
    expect((await withSchool(fx.school.id, (tx) => tx.select().from(feeCounters).where(eq(feeCounters.id, closed.counter.id))))[0]!.differenceState).toBe("recount");
    await withSchool(fx.school.id, (tx) => tx.update(feeCounters).set({ day: sql`(current_date - 3)` }).where(eq(feeCounters.id, closed.counter.id)));
    await config(fx, { autoUseAdvance: true });
  });
});

describe("the counter", () => {
  const row = (id: string) => withSchool(fx.school.id, async (tx) => (await tx.select().from(feeCounters).where(eq(feeCounters.id, id)))[0]!);
  const age = (id: string, days: number) => withSchool(fx.school.id, (tx) => tx.update(feeCounters).set({ day: sql`(current_date - ${days}::int)` }).where(eq(feeCounters.id, id)));

  it("6: cash a cashier refunded is not taken from another cashier's box", async () => {
    const [mine, theirs] = [new CounterService(accountant()), new CounterService(admin())];
    const a = await mine.open({ floatPaise: 0 });
    const b = await theirs.open({ floatPaise: 0 });
    const id = await newStudent(fx, "Cash Refund");
    await receipts().collect({ studentId: id, methods: [{ method: "cash", amountPaise: 250_000 }] }); // 200,000 due, 50,000 advance
    await config(fx, { autoUseAdvance: false });
    const before = (await mine.current())!.expectedPaise;
    const refund = await new RefundService(accountant()).propose({ studentId: id, source: "advance", amountPaise: 30_000, method: "cash", reason: "Overpaid" });
    await decide(fx, "fees.refund", refund.id);
    expect((await mine.current())!.expectedPaise).toBe(before - 30_000);
    expect((await theirs.current())!.expectedPaise).toBe(0);
    await mine.close({ countedPaise: before - 30_000 });
    await theirs.close({ countedPaise: 0 });
    await Promise.all([age(a.id, 5), age(b.id, 5)]);
    await config(fx, { autoUseAdvance: true });
  });

  it("10: counting a counter again cannot hide its first difference", async () => {
    const c = new CounterService(accountant());
    await c.open({ floatPaise: 1_000_000 }); // big enough to cover the cash refunds this cashier made earlier today
    const should = (await c.current())!.expectedPaise;
    const first = await c.close({ countedPaise: should - 10_000, differenceReason: "Counted by hand" });
    await c.withdraw(first.counter.id);
    await c.reopen(first.counter.id);
    const again = await c.close({ countedPaise: should });
    expect(again.differencePaise).toBe(0);
    expect(await row(first.counter.id)).toMatchObject({ differenceState: "pending", firstCountedPaise: should - 10_000, firstExpectedPaise: should });
    expect((await pendingApproval("fees.counter_difference", first.counter.id)).reason).toMatch(/First count: the box should hold .*counted .*Counted again/);
    await decide(fx, "fees.counter_difference", first.counter.id);
    expect(await row(first.counter.id)).toMatchObject({ differenceState: "posted" });
    expect(await checks()).toEqual([]);
    await age(first.counter.id, 9); // so the cashier can take money again today
  });
});

describe("setup, forms and reports", () => {
  it("11: a fee cannot book to a system account, and its type is fixed once bills use it", async () => {
    const heads = new HeadService(admin());
    const [cash] = await withSchool(fx.school.id, (tx) => tx.select({ id: finAccounts.id }).from(finAccounts).where(eq(finAccounts.systemKey, "cash")));
    await expect(heads.create({ name: "Lab fee", accountId: cash!.id })).rejects.toThrow(/cannot take fee income/);
    await expect(heads.update(fx.heads.tuition, { name: "Tuition", kind: "tuition", type: "deposit", isTuition: "true", isActive: "true" })).rejects.toThrow(/Bills already use Tuition/);
  });

  it("14: the same collect form sent twice, even at once, makes one receipt", async () => {
    const id = await newStudent(fx, "Twice One");
    const body = { studentId: id, requestId: "form-0001", methods: upi(50_000, "UTR-TWICE") };
    const [a, b] = await Promise.all([receipts().collect(body), receipts().collect(body)]);
    expect(a.id).toBe(b.id);
    expect((await receipts().list({ filters: { studentId: id } })).total).toBe(1);
    expect((await account(id)).balance.openPaise).toBe(150_000);
  });

  it("the receipt prints the balance after its own payment, not before it", async () => {
    const id = await newStudent(fx, "Balance One"); // owes 200,000
    const r = await receipts().collect({ studentId: id, methods: upi(50_000, "UTR-BAL") });
    expect((await receipts().document(r.id)).data.totals.find((t) => t[0] === "Balance after payment")?.[1]).toBe("₹1,500");
  });

  it("15: a UPI slip only takes a file this school's upload made", async () => {
    await config(fx, { upiOn: true });
    const [bill] = await bills(fx, fx.students.riya);
    const slips = new SlipService(fx.school.as.student);
    const slip = { amountPaise: 50_000, utr: "UTR900001", paidOn: TODAY, invoiceIds: [bill!.id] };
    await expect(slips.submit({ ...slip, fileKey: "another-school/fees/slips/x.png" })).rejects.toBeInstanceOf(ValidationError);
    await expect(slips.submit({ ...slip, utr: "UTR900002", fileKey: `${fx.school.id}/fees/slips/x.png` })).resolves.toMatchObject({ fileKey: `${fx.school.id}/fees/slips/x.png` });
  });

  it("16: a draft bill with lines can be deleted", async () => {
    const inv = new InvoiceService(accountant());
    const id = await inv.saveDraft({ studentId: fx.students.neel, label: "Trip", dueDate: TODAY, lines: [{ headId: fx.heads.exam, label: "Trip", amountPaise: 5_000 }] }) as unknown as string;
    await expect(inv.deleteDraft(id)).resolves.toEqual({ id });
  });

  it("17: reports by cashier and by day leave out the part paid from the advance", async () => {
    await config(fx, { autoUseAdvance: false });
    const dues = new DuesService(admin());
    const total = async (by: "cashier" | "day") => (await dues.collection({ from: TODAY, to: TODAY, by })).totalPaise;
    const before = [await total("cashier"), await total("day")];
    const id = await newStudent(fx, "Advance Mix", { issue: false });
    await openingApproved(fx, csv([[await admissionNo(id), "", "200", "", ""]]));
    await new InvoiceService(admin()).issueBulk({}, TODAY);
    await receipts().collect({ studentId: id, methods: [{ method: "advance", amountPaise: 20_000 }, ...upi(80_000, "UTR-MIX")] });
    expect([await total("cashier"), await total("day")]).toEqual([before[0]! + 80_000, before[1]! + 80_000]);
    await config(fx, { autoUseAdvance: true });
  });

  it("19: the dues download reads every row in one run of the query", async () => {
    const dues = new DuesService(admin());
    const all = await dues.reportAll({});
    expect(all.length).toBe((await dues.report({ pageSize: 100 })).total);
  });
});
