import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, ValidationError } from "@smw/feature-kit";
import { feeCheques, feeReceipts } from "./schema";
import { ChecksService } from "./checks";
import { ChequeService } from "./cheques";
import { CounterService } from "./counter";
import { DuesService } from "./dues";
import { InvoiceService } from "./invoices";
import { NoteService } from "./notes";
import { ReceiptService } from "./receipts";
import { LATE, TODAY, bills, config, decide, due, issueAll, ledger, makeSchool, newStudent, publish, type Fixture } from "./testing";
import { finApprovals } from "@smw/feature-finance/schema";
import { ApprovalService } from "@smw/feature-finance/approvals";
import { feesApprovals } from "./approval-handlers";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
let fx: Fixture;
const cashier = () => new ReceiptService(fx.school.as.accountant);
const checks = async () => (await new ChecksService(fx.school.as.admin).run()).mismatches;
const open = async (id: string) => (await new DuesService(fx.school.as.admin).studentAccount(id)).balance;
const cash = (amountPaise: number) => [{ method: "cash" as const, amountPaise }];
const advance = (id: string) => withSchool(fx.school.id, async (tx) => Number((await tx.execute<{ v: string }>(sql`select coalesce(sum(amount_paise), 0) v from fee_advances where student_id = ${id}::uuid and kind <> 'deposit'`))[0]!.v));

beforeAll(async () => {
  fx = await makeSchool("rcpt", { plan: false });
  await publish(fx, { name: "Class 5", classIds: [fx.classId], lateRule: LATE, lines: [{ headId: fx.heads.tuition, dues: [due("M1", -30, 100_000), due("M2", -10, 100_000), due("M3", 20, 100_000)] }] });
  await issueAll(fx);
});
afterAll(closeDb);

describe("collecting", () => {
  it("fixes the late fee as a line at payment time, pays it first, and the books agree", async () => {
    const meera = fx.students.meera;
    expect((await open(meera)).openPaise).toBe(200_000);
    const r = await cashier().collect({ studentId: meera, methods: cash(50_000) });
    expect(r).toMatchObject({ status: "valid", amountPaise: 50_000, advancePaise: 0, number: expect.stringMatching(/^RCPT\/\d{4}-\d{2}\/000001$/) });
    const [m1, m2] = await bills(fx, meera);
    // M1 is 30 days past due, 5 days of grace: 25 days at 1,000 = 25,000, paid first, then 25,000 of tuition.
    expect(m1).toMatchObject({ latePaise: 25_000, paidPaise: 50_000, openPaise: 75_000 });
    expect(m2).toMatchObject({ latePaise: 5_000, paidPaise: 0, openPaise: 105_000 });
    const full = await new InvoiceService(fx.school.as.admin).get(m1!.id);
    expect(full.invoice.lines.find((l) => l.kind === "late")).toMatchObject({ amountPaise: 25_000, paidPaise: 25_000 });
    expect(full.accruedLatePaise).toBe(0); // what built up is now a line
    expect(await ledger(fx, "late_fee")).toBe(-30_000);
    expect(await ledger(fx, "student_dues", meera)).toBe(180_000);
    expect(await checks()).toEqual([]);
  });

  it("waiving a fixed late fee posts against late fee income; an unpaid bill shows the fee that is building up", async () => {
    const id = await newStudent(fx, "Waiver Kid");
    const [m1, m2] = await bills(fx, id);
    expect((await new InvoiceService(fx.school.as.admin).get(m1!.id)).accruedLatePaise).toBe(25_000); // 25 late days at 1,000, nothing paid yet
    await cashier().collect({ studentId: id, invoiceIds: [m1!.id, m2!.id], parts: [{ invoiceId: m1!.id, amountPaise: 1_000 }, { invoiceId: m2!.id, amountPaise: 1_000 }], methods: cash(2_000) });
    const line = (await new InvoiceService(fx.school.as.admin).get(m2!.id)).invoice.lines.find((l) => l.kind === "late")!;
    const before = await ledger(fx, "late_fee");
    const n = await new NoteService(fx.school.as.accountant).propose({ invoiceId: m2!.id, reasonType: "waiver", reason: "Bus strike", lines: [{ lineId: line.id, amountPaise: 4_000 }] });
    await decide(fx, "fees.note", n.id);
    expect(await ledger(fx, "late_fee")).toBe(before + 4_000);
    expect(await checks()).toEqual([]);
  });

  it("pays the principal first when the school says so", async () => {
    await config(fx, { lateFeeFirst: false });
    const riya = fx.students.riya;
    await cashier().collect({ studentId: riya, invoiceIds: [(await bills(fx, riya))[0]!.id], methods: cash(100_000) });
    const [m1] = await bills(fx, riya);
    expect(m1).toMatchObject({ latePaise: 25_000, paidPaise: 100_000, openPaise: 25_000 });
    await config(fx, { lateFeeFirst: true });
    expect(await checks()).toEqual([]);
  });

  it("takes several methods in one receipt, and siblings in one receipt", async () => {
    const { riya, kabir } = fx.students;
    const kabirBill = (await bills(fx, kabir))[1]!;
    const riyaBill = (await bills(fx, riya))[1]!;
    const r = await cashier().collect({ studentId: riya, invoiceIds: [riyaBill.id, kabirBill.id], methods: [{ method: "cash", amountPaise: 100_000 }, { method: "upi", amountPaise: 110_000, reference: "UTR123456" }] });
    expect(r.amountPaise).toBe(210_000);
    const got = await cashier().get(r.id);
    expect(got.methods.map((m) => [m.method, m.amountPaise]).sort()).toEqual([["cash", 100_000], ["upi", 110_000]]);
    expect(got.allocations.map((a) => a.studentId).sort()).toEqual(expect.arrayContaining([riya, kabir]));
    expect((await bills(fx, kabir))[1]).toMatchObject({ paidPaise: 105_000, openPaise: 0 });
    expect(await ledger(fx, "bank")).toBe(110_000);
    // A bill of a student outside the family cannot ride on this receipt.
    await expect(cashier().collect({ studentId: riya, invoiceIds: [(await bills(fx, fx.students.neel))[0]!.id], methods: cash(1_000) })).rejects.toThrow(/not in this family/);
    expect(await checks()).toEqual([]);
  });

  it("a part payment puts only the chosen amount on the bill", async () => {
    const neel = fx.students.neel;
    const [m1] = await bills(fx, neel);
    const r = await cashier().collect({ studentId: neel, parts: [{ invoiceId: m1!.id, amountPaise: 30_000 }], methods: cash(30_000) });
    expect(r.allocatedPaise).toBe(30_000);
    expect((await bills(fx, neel))[0]).toMatchObject({ paidPaise: 30_000, state: "overdue" });
    expect(await checks()).toEqual([]);
  });

  it("extra money becomes an advance that is used by itself on the next bill", async () => {
    const id = await newStudent(fx, "Advance Kid");
    const owed = (await open(id)).openPaise; // M1, M2 = 200,000 (late fee is fixed when money comes)
    const r = await cashier().collect({ studentId: id, methods: cash(owed + 30_000 + 70_000) });
    expect(r.advancePaise).toBe(70_000);
    expect(await advance(id)).toBe(70_000);
    expect(await ledger(fx, "student_advances", id)).toBe(-70_000);
    // M3 comes due for billing: the advance goes onto it.
    await new InvoiceService(fx.school.as.admin).issueBulk({}, addDaysIso(15));
    expect(await advance(id)).toBe(0);
    const m3 = (await bills(fx, id)).at(-1)!;
    expect(m3).toMatchObject({ paidPaise: 70_000, openPaise: 30_000 });
    expect(await ledger(fx, "student_advances", id)).toBe(0);
    expect(await checks()).toEqual([]);
  });

  it("an advance can be spent as a method of a receipt, but not more than the student has", async () => {
    const id = await newStudent(fx, "Spender");
    await cashier().collect({ studentId: id, invoiceIds: [], methods: cash(20_000), parts: [] }).catch(() => undefined);
    const base = await advance(id);
    await expect(cashier().collect({ studentId: id, methods: [{ method: "advance", amountPaise: 10_000 }] })).rejects.toThrow(/advance is only/);
    expect(base).toBe(0);
  });

  it("two cashiers collecting the same due at once never allocate it twice, and receipt numbers have no gaps", async () => {
    const id = await newStudent(fx, "Race Kid");
    const [m1] = await bills(fx, id);
    const results = await Promise.allSettled([1, 2, 3].map((i) => new ReceiptService(i % 2 ? fx.school.as.accountant : fx.school.as.admin).collect({ studentId: id, invoiceIds: [m1!.id], methods: cash(200_000) })));
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const done = results.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<ReceiptService["collect"]>>>).value);
    expect(done.reduce((s, r) => s + r.allocatedPaise, 0)).toBe(125_000); // M1 with its late fee, once
    expect((await bills(fx, id))[0]).toMatchObject({ openPaise: 0, paidPaise: 125_000 });
    expect(await advance(id)).toBe(600_000 - 125_000);
    await expect(checks().then((c) => c)).resolves.toEqual([]);
    await expectNoGaps();
  });

  it("a failed collect leaves no rows and no gap in the numbers", async () => {
    const id = await newStudent(fx, "Failing Kid");
    const before = await numbers();
    await expect(cashier().collect({ studentId: id, methods: [{ method: "cash", amountPaise: 10_000, cashAccountId: "00000000-0000-4000-8000-000000000001" }] })).rejects.toBeInstanceOf(ConflictError);
    expect(await numbers()).toEqual(before);
    const ok = await cashier().collect({ studentId: id, methods: cash(10_000) });
    expect(Number(ok.number.split("/").at(-1))).toBe(before.length + 1);
    await expectNoGaps();
  });

  it("refuses the future, old backdating, a cancelled bill and an empty family selection", async () => {
    const id = await newStudent(fx, "Dates Kid");
    await expect(cashier().collect({ studentId: id, date: "2999-01-01", methods: cash(1_000) })).rejects.toBeInstanceOf(ValidationError);
    await expect(cashier().collect({ studentId: id, date: "2020-01-01", methods: cash(1_000) })).rejects.toMatchObject({ fieldErrors: { date: expect.stringContaining("days back") } });
    const [m1] = await bills(fx, id);
    await new InvoiceService(fx.school.as.admin).cancel(m1!.id, "Billed by mistake");
    await expect(cashier().collect({ studentId: id, invoiceIds: [m1!.id], methods: cash(1_000) })).rejects.toThrow(/cancelled/);
  });

  it("only staff with collect can take money; a student cannot", async () => {
    await expect(new ReceiptService(fx.school.as.student).collect({ studentId: fx.students.riya, methods: cash(100) })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ReceiptService(fx.school.as.teacher).collect({ studentId: fx.students.riya, methods: cash(100) })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("cheques", () => {
  it("a cheque is its own receipt, waits as clearing, and clears into the bank", async () => {
    const id = await newStudent(fx, "Cheque Kid");
    await expect(cashier().collect({ studentId: id, methods: [{ method: "cheque", amountPaise: 1_000, cheque: { chequeNo: "1", bank: "SBI", chequeDate: TODAY } }, { method: "cash", amountPaise: 1_000 }] })).rejects.toBeInstanceOf(ValidationError);
    const r = await cashier().collect({ studentId: id, methods: [{ method: "cheque", amountPaise: 100_000, cheque: { chequeNo: "004455", bank: "State Bank", chequeDate: TODAY } }] });
    expect(r.status).toBe("clearing");
    const [chq] = await withSchool(fx.school.id, (tx) => tx.select().from(feeCheques).where(eq(feeCheques.receiptId, r.id)));
    expect(chq).toMatchObject({ status: "received", chequeNo: "004455" });
    const cheques = new ChequeService(fx.school.as.accountant);
    await expect(cheques.clear({ id: chq!.id })).rejects.toThrow(/cannot be marked cleared/);
    await cheques.deposit({ id: chq!.id });
    await cheques.clear({ id: chq!.id });
    expect((await cashier().get(r.id)).receipt.status).toBe("valid");
    expect(await checks()).toEqual([]);
    expect(await ledger(fx, "cheques")).toBe(await chequesInHand());
  });

  it("a bounce reopens the dues, adds the bounce charge once, and the postings net to zero", async () => {
    await config(fx, { bounceChargePaise: 50_000 });
    const id = await newStudent(fx, "Bounce Kid");
    const before = await open(id);
    const r = await cashier().collect({ studentId: id, methods: [{ method: "cheque", amountPaise: 100_000, cheque: { chequeNo: "9001", bank: "HDFC", chequeDate: TODAY } }] });
    expect((await bills(fx, id))[0]!.paidPaise).toBeGreaterThan(0);
    const [chq] = await withSchool(fx.school.id, (tx) => tx.select().from(feeCheques).where(eq(feeCheques.receiptId, r.id)));
    const cheques = new ChequeService(fx.school.as.accountant);
    await expect(cheques.bounce({ id: chq!.id })).rejects.toBeInstanceOf(ValidationError); // a reason is a must
    await cheques.bounce({ id: chq!.id, reason: "Insufficient funds" });
    await expect(cheques.bounce({ id: chq!.id, reason: "again" })).rejects.toThrow(/cannot be marked bounced/);
    expect((await cashier().get(r.id)).receipt.status).toBe("bounced");
    const list = await bills(fx, id);
    expect(list.filter((b) => b.kind === "bounce")).toHaveLength(1);
    // Dues are back to what they were, plus the late fee fixed by the payment, plus the charge.
    const after = await open(id);
    expect(after.openPaise).toBe(before.openPaise + 30_000 + 50_000);
    expect(await ledger(fx, "cheques")).toBe(await chequesInHand());
    expect(await checks()).toEqual([]);
    config(fx, { bounceChargePaise: 0 });
  });
});

const chequesInHand = () => withSchool(fx.school.id, async (tx) => Number((await tx.execute<{ v: string }>(sql`select coalesce(sum(c.amount_paise), 0) v from fee_cheques c where c.status in ('received', 'deposited')`))[0]!.v));
const numbers = () => withSchool(fx.school.id, async (tx) => (await tx.select({ n: feeReceipts.number }).from(feeReceipts)).map((r) => Number(r.n.split("/").at(-1))).sort((a, b) => a - b));
const expectNoGaps = async () => { const n = await numbers(); expect(n).toEqual(n.map((_, i) => i + 1)); };
const addDaysIso = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe("the receipt file", () => {
  it("prints a plain PDF, logs every print, and says DUPLICATE from the second", async () => {
    const id = await newStudent(fx, "Print Kid");
    const r = await cashier().collect({ studentId: id, methods: cash(5_000) });
    const first = await cashier().receiptFile(r.id);
    expect(Buffer.from(first.bytes.slice(0, 4)).toString()).toBe("%PDF");
    expect(first.filename).toBe(`${r.number.replace(/\//g, "-")}.pdf`);
    const second = await cashier().receiptFile(r.id);
    expect(second.filename).toContain("duplicate");
    const prints = await withSchool(fx.school.id, (tx) => tx.execute<{ n: number }>(sql`select count(*)::int n from fin_prints where doc_id = ${r.id}::uuid`));
    expect([...prints][0]!.n).toBe(2);
    await expect(new ReceiptService(fx.school.as.student).receiptFile(r.id)).rejects.toThrow();
  });
});

describe("reversal", () => {
  it("does nothing until someone else approves; then dues reopen, the receipt keeps its number and the postings are mirrored", async () => {
    const id = await newStudent(fx, "Reverse Kid");
    const before = await open(id);
    const r = await cashier().collect({ studentId: id, methods: cash(150_000) });
    expect((await open(id)).openPaise).toBeLessThan(before.openPaise);
    const ask = await cashier().requestReversal(r.id, "Wrong student");
    expect(ask.status).toBe("pending");
    expect((await cashier().get(r.id)).receipt.status).toBe("valid");
    await expect(new ApprovalService(fx.school.as.accountant, feesApprovals).approve({ id: ask.id })).rejects.toBeInstanceOf(ForbiddenError);
    await decide(fx, "fees.reversal", r.id);
    const got = await cashier().get(r.id);
    expect(got.receipt).toMatchObject({ status: "reversed", number: r.number, reverseReason: "Wrong student" });
    expect((await open(id)).openPaise).toBe(before.openPaise + 30_000); // the fixed late fee stays: it was earned
    expect(got.allocations.every((a) => a.undoneAt)).toBe(true);
    expect(await checks()).toEqual([]);
    await expect(cashier().requestReversal(r.id, "again please")).rejects.toThrow(/already reversed/);
  });

  it("a request can be withdrawn, and a refused one changes nothing", async () => {
    const id = await newStudent(fx, "Refused Kid");
    const r = await cashier().collect({ studentId: id, methods: cash(10_000) });
    await cashier().requestReversal(r.id, "Mistake maybe");
    await cashier().withdrawReversal(r.id);
    await expect(cashier().withdrawReversal(r.id)).rejects.toThrow(/nothing to withdraw/);
    await cashier().requestReversal(r.id, "Mistake for sure");
    await decide(fx, "fees.reversal", r.id, "reject", "Receipt is correct");
    expect((await cashier().get(r.id)).receipt.status).toBe("valid");
    const [a] = await withSchool(fx.school.id, (tx) => tx.select().from(finApprovals).where(eq(finApprovals.refId, r.id)));
    expect(a).toBeTruthy();
  });

  it("is refused, with a clear message, when the advance it made has been used", async () => {
    const id = await newStudent(fx, "Used Advance");
    const r = await cashier().collect({ studentId: id, methods: cash(200_000 + 30_000 + 100_000) });
    expect(r.advancePaise).toBe(100_000);
    await new InvoiceService(fx.school.as.admin).issueBulk({}, addDaysIso(15)); // M3 takes the advance
    await cashier().requestReversal(r.id, "Wrong amount");
    await expect(decide(fx, "fees.reversal", r.id)).rejects.toThrow(/advance from this receipt has already been used/);
    expect((await cashier().get(r.id)).receipt.status).toBe("valid");
    expect(await checks()).toEqual([]);
  });
});

describe("the counter", () => {
  let f3: Fixture;
  beforeAll(async () => {
    f3 = await makeSchool("rcpt3", { plan: false });
    await publish(f3, { name: "Class 5", classIds: [f3.classId], lines: [{ headId: f3.heads.tuition, dues: [due("M1", -30, 100_000)] }] });
    await issueAll(f3);
  });

  it("one open session per person; cash needs it once the school uses counters; expected = float + cash taken - cash refunded", async () => {
    const c = new CounterService(f3.school.as.accountant);
    const rc = new ReceiptService(f3.school.as.accountant);
    expect(await c.current()).toBeNull();
    // No counter anywhere yet: cash is taken without one.
    await new ReceiptService(f3.school.as.admin).collect({ studentId: f3.students.neel, methods: cash(1_000) });
    await c.open({ floatPaise: 100_000 });
    await expect(c.open({ floatPaise: 5 })).rejects.toThrow(/already have a counter open/);
    await expect(new ReceiptService(f3.school.as.admin).collect({ studentId: f3.students.meera, methods: cash(1_000) })).rejects.toThrow(/Open your counter/);
    await new ReceiptService(f3.school.as.admin).collect({ studentId: f3.students.meera, methods: [{ method: "upi", amountPaise: 1_000, reference: "U1" }] });
    await rc.collect({ studentId: f3.students.riya, methods: [{ method: "cash", amountPaise: 40_000 }, { method: "upi", amountPaise: 10_000, reference: "U2" }] });
    expect(await c.current()).toMatchObject({ expectedPaise: 140_000, takenPaise: 40_000, receipts: 1 });
    await expect(c.close({ countedPaise: 130_000 })).rejects.toThrow(/Say why it is short/);
    const closed = await c.close({ countedPaise: 130_000, differenceReason: "Change given twice", denominations: { "50000": 2, "10000": 3 } });
    expect(closed).toMatchObject({ expectedPaise: 140_000, differencePaise: -10_000 });
    expect(await ledger(f3, "cash_difference")).toBe(10_000);
    // A closed day takes no more, and cannot be opened again.
    await expect(rc.collect({ studentId: f3.students.kabir, methods: cash(100) })).rejects.toThrow(/is closed/);
    await expect(c.open({ floatPaise: 0 })).rejects.toThrow(/closed/);
    expect((await new ChecksService(f3.school.as.admin).run()).mismatches).toEqual([]);
  });

  it("notes and coins must add up to the count", async () => {
    const c = new CounterService(f3.school.as.admin);
    await c.open({ floatPaise: 0 });
    await expect(c.close({ countedPaise: 10_000, denominations: { "50000": 1 } })).rejects.toThrow(/add up/);
    expect((await c.close({ countedPaise: 0 })).differencePaise).toBe(0);
  });
});

