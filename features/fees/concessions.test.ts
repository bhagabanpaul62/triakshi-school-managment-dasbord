import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, withSchool } from "@smw/db";
import { ConflictError } from "@smw/feature-kit";
import { addDays } from "@smw/feature-kit/money";
import { students } from "@smw/feature-students/schema";
import { ChecksService } from "./checks";
import { ConcessionService, ConcessionTypeService } from "./concessions";
import { DuesService } from "./dues";
import { InvoiceService } from "./invoices";
import { ReceiptService } from "./receipts";
import { RefundService } from "./refunds";
import { SettlementService } from "./settlements";
import { feeConcessions } from "./schema";
import { LATE, TODAY, bills, config, decide, due, issueAll, ledger, makeSchool, newStudent, openingApproved, publish, type Fixture } from "./testing";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });
let fx: Fixture;
const accountant = () => fx.school.as.accountant;
const checks = async () => (await new ChecksService(fx.school.as.admin).run()).mismatches;
const account = (id: string) => new DuesService(fx.school.as.admin).studentAccount(id);
const csv = (rows: string[][]) => ({ name: "opening.csv", bytes: new TextEncoder().encode(["admission_no,dues,advance,deposit,as_of", ...rows.map((r) => r.join(","))].join("\n")) });
const admissionNo = (id: string) => withSchool(fx.school.id, async (tx) => (await tx.select({ n: students.admissionNo }).from(students).where(eq(students.id, id)))[0]!.n);

beforeAll(async () => {
  fx = await makeSchool("conc", { plan: false });
  await publish(fx, { name: "Class 5", classIds: [fx.classId], lateRule: LATE, lines: [
    { headId: fx.heads.tuition, dues: [due("M1", -30, 100_000), due("M2", -10, 100_000)] },
    { headId: fx.heads.exam, dues: [due("M1", -30, 20_000)] },
  ] });
});
afterAll(closeDb);

describe("concessions", () => {
  it("one approved before billing is on every bill issued after, percent and per head, and nothing applies by itself", async () => {
    const { meera, neel } = fx.students;
    const svc = new ConcessionService(accountant());
    const p = await svc.propose({ studentId: meera, mode: "percent", value: 1000, reason: "Sibling" });
    expect(p.status).toBe("pending");
    const exam = await svc.propose({ studentId: neel, headId: fx.heads.exam, mode: "percent", value: 5000, reason: "Merit" });
    await issueAll(fx, undefined);
    expect((await bills(fx, meera))[0]).toMatchObject({ concessionPaise: 0 }); // not approved yet
    // Cancel and re-issue is not how it works: the approval cuts the open bills by a credit note.
    await decide(fx, "fees.concession", p.id);
    await decide(fx, "fees.concession", exam.id);
    expect((await bills(fx, meera))[0]).toMatchObject({ creditedPaise: 12_000, openPaise: 108_000 }); // 10% of 120,000 on the first bill
    expect((await bills(fx, neel))[0]).toMatchObject({ creditedPaise: 10_000 }); // half of the exam fee only
    expect((await bills(fx, meera))[1]).toMatchObject({ creditedPaise: 10_000 });
    expect(await ledger(fx, "concessions")).toBe(12_000 + 10_000 + 10_000);
    expect(await checks()).toEqual([]);
  });

  it("an approved concession is on bills issued afterwards and is cut at issue (no note)", async () => {
    const id = await newStudent(fx, "Later Kid", { issue: false });
    const c = await new ConcessionService(accountant()).propose({ studentId: id, mode: "amount", per: "bill", value: 15_000, reason: "Need" });
    await decide(fx, "fees.concession", c.id);
    await issueAll(fx, undefined);
    expect((await bills(fx, id))[0]).toMatchObject({ concessionPaise: 15_000, creditedPaise: 0, grossPaise: 120_000 });
    expect(await checks()).toEqual([]);
  });

  it("under the school's limit it applies at once; over it needs approval; it can be withdrawn and sent again", async () => {
    await config(fx, { concessionLimitPaise: 50_000 });
    const id = await newStudent(fx, "Limit Kid");
    const svc = new ConcessionService(accountant());
    expect((await svc.propose({ studentId: id, mode: "amount", value: 5_000, reason: "Small" })).status).toBe("approved");
    const big = await svc.propose({ studentId: id, mode: "percent", value: 10_000, reason: "Full waiver asked" });
    expect(big.status).toBe("pending");
    await svc.withdraw(big.id);
    const again = await svc.resubmit(big.id, { studentId: id, mode: "percent", value: 5_000, reason: "Half, after talking" });
    expect(again.status).toBe("pending");
    await decide(fx, "fees.concession", again.id, "reject", "Not this year");
    await expect(svc.end(again.id)).rejects.toBeInstanceOf(ConflictError);
    await config(fx, { concessionLimitPaise: 0 });
  });

  it("suggests siblings, RTE seats and staff children, and applies none of them", async () => {
    await withSchool(fx.school.id, (tx) => tx.update(students).set({ rteQuota: true }).where(eq(students.id, fx.students.neel)));
    const types = new ConcessionTypeService(accountant());
    await types.create({ name: "Sibling", auto: "sibling", mode: "percent", value: 1000, isActive: "true" });
    const before = (await withSchool(fx.school.id, (tx) => tx.select().from(feeConcessions))).length;
    const s = await new ConcessionService(accountant()).suggestions();
    expect(s.filter((x) => x.kind === "sibling").map((x) => x.studentId)).toEqual([expect.stringMatching(/.+/)]);
    expect([fx.students.riya, fx.students.kabir]).toContain(s.find((x) => x.kind === "sibling")!.studentId);
    expect(s.find((x) => x.kind === "rte")).toMatchObject({ studentId: fx.students.neel, mode: "percent", value: 10_000 });
    expect((await withSchool(fx.school.id, (tx) => tx.select().from(feeConcessions))).length).toBe(before);
  });
});

describe("opening balances, deposits and refunds", () => {
  it("a dry run writes nothing; one bad row stops all; a good sheet posts to Opening balances once", async () => {
    const id = await newStudent(fx, "Opening Kid", { issue: false });
    const no = await admissionNo(id);
    const inv = new InvoiceService(accountant());
    const bad = await inv.importOpening(csv([[no, "5000", "200", "300", ""], ["NOPE", "1", "", "", ""]]), false);
    expect(bad).toMatchObject({ applied: false, errors: [{ line: 3, message: expect.stringContaining("NOPE") }] });
    expect((await account(id)).balance.openPaise).toBe(0);
    expect((await inv.importOpening(csv([[no, "5000", "200", "300", ""]]), true))).toMatchObject({ applied: false, errors: [], totals: { students: 1, duesPaise: 500_000, advancePaise: 20_000, depositPaise: 30_000 } });
    expect((await account(id)).balance.openPaise).toBe(0);
    expect(await openingApproved(fx, csv([[no, "5000", "200", "300", ""]]))).toMatchObject({ applied: true });
    expect((await account(id)).balance).toMatchObject({ openPaise: 500_000, advancePaise: 20_000, depositPaise: 30_000 });
    expect(await ledger(fx, "opening", id)).toBe(0); // opening postings carry no student party on the equity side
    expect(await ledger(fx, "student_dues", id)).toBe(500_000);
    await expect(inv.importOpening(csv([[no, "1", "", "", ""]]), false)).resolves.toMatchObject({ applied: false, errors: [{ message: expect.stringContaining("already has opening balances") }] });
    expect(await checks()).toEqual([]);
  });

  it("deposit heads post to deposits payable; a refund from a deposit needs approval, gets a voucher and never goes below zero", async () => {
    const id = await newStudent(fx, "Deposit Kid", { issue: false });
    const inv = new InvoiceService(accountant());
    const draft = await inv.saveDraft({ studentId: id, label: "Caution deposit", dueDate: TODAY, lines: [{ headId: fx.heads.deposit, label: "Caution deposit", amountPaise: 200_000 }] });
    void draft;
    const [d] = (await inv.list({ filters: { studentId: id, status: "draft" } })).rows;
    await inv.issue(d!.id);
    expect(await ledger(fx, "deposits_payable", id)).toBe(-200_000);
    const refunds = new RefundService(accountant());
    await expect(refunds.propose({ studentId: id, source: "deposit", amountPaise: 100_000, method: "cash", reason: "Left school" })).rejects.toThrow(/Only ₹0/); // not paid yet
    await new ReceiptService(accountant()).collect({ studentId: id, invoiceIds: [d!.id], methods: [{ method: "upi", amountPaise: 200_000, reference: "UTRDEP1" }] });
    const r = await refunds.propose({ studentId: id, source: "deposit", amountPaise: 150_000, method: "cash", reason: "Left school" });
    await expect(refunds.propose({ studentId: id, source: "deposit", amountPaise: 60_000, method: "cash", reason: "Too much" })).rejects.toThrow(/Only ₹500 /);
    await decide(fx, "fees.refund", r.id);
    const [done] = (await refunds.list({ filters: { studentId: id } })).rows;
    expect(done).toMatchObject({ status: "approved", number: expect.stringMatching(/^PV\//), amountPaise: 150_000 });
    expect((await account(id)).balance.depositPaise).toBe(50_000);
    expect(await ledger(fx, "deposits_payable", id)).toBe(-50_000);
    expect(await ledger(fx, "cash")).toBe(-150_000);
    expect(await checks()).toEqual([]);
  });

  it("a refund request can be withdrawn, edited and sent again", async () => {
    const id = await newStudent(fx, "Refund Kid", { issue: false });
    await openingApproved(fx, csv([[await admissionNo(id), "", "100", "", ""]]));
    const refunds = new RefundService(accountant());
    const r = await refunds.propose({ studentId: id, source: "advance", amountPaise: 10_000, method: "bank_transfer", reason: "Overpaid" });
    await refunds.withdraw(r.id);
    const again = await refunds.resubmit(r.id, { studentId: id, source: "advance", amountPaise: 8_000, method: "bank_transfer", reason: "Overpaid, corrected" });
    expect(again).toMatchObject({ id: r.id, status: "pending", amountPaise: 8_000 });
    await decide(fx, "fees.refund", r.id, "reject", "Check the bank detail");
    await expect(refunds.resubmit(r.id, { studentId: id, source: "advance", amountPaise: 8_000, method: "cash", reason: "Cash instead" })).resolves.toMatchObject({ status: "pending" });
  });
});

describe("settlements", () => {
  it("one approval waives, uses the advance and deposit, writes off and splits what is left into dated parts that drive the due state", async () => {
    await issueAll(fx, undefined);
    await config(fx, { autoUseAdvance: false }); // keep the advance so the settlement can use it
    const id = await newStudent(fx, "Hard Case", { issue: false });
    await openingApproved(fx, csv([[await admissionNo(id), "", "200", "300", ""]]));
    await issueAll(fx, undefined);
    await config(fx, { autoUseAdvance: true });
    const owed = (await account(id)).balance.openPaise; // M1 + exam + M2 = 220,000
    expect(owed).toBe(220_000);
    const [first, second] = [addDays(TODAY, 10), addDays(TODAY, 40)];
    const deal = { studentId: id, reason: "Family in hardship", waiveLate: true, useAdvancePaise: 20_000, useDepositPaise: 30_000, writeOffPaise: 10_000, parts: [{ dueOn: first, amountPaise: 60_000 }, { dueOn: second, amountPaise: 100_000 }] };
    const svc = new SettlementService(accountant());
    await expect(svc.propose({ ...deal, parts: [{ dueOn: first, amountPaise: 10_000 }] })).rejects.toThrow(/dates add up to ₹100/);
    const preview = await svc.preview(deal);
    expect(preview).toMatchObject({ openBeforePaise: 220_000, advancePaise: 20_000, depositPaise: 30_000, writtenOffPaise: 10_000, remainingPaise: 160_000 });
    expect((await account(id)).balance.openPaise).toBe(owed); // previewing changed nothing
    const s = await svc.propose(deal);
    expect(s.status).toBe("pending");
    await decide(fx, "fees.settlement", s.id);
    const a = await account(id);
    expect(a.balance).toMatchObject({ openPaise: 160_000, advancePaise: 0, depositPaise: 0 });
    expect(a.invoices.map((b) => b.state)).not.toContain("overdue"); // the old due dates no longer apply
    const row = (await new DuesService(accountant()).report({ q: "Hard Case" })).rows[0]!;
    expect(row).toMatchObject({ due: 160_000, overdue: 0, nextDueDate: first, accrued: 0 });
    expect(await ledger(fx, "bad_debts")).toBe(10_000);
    expect(await ledger(fx, "student_advances", id)).toBe(0);
    expect(await ledger(fx, "deposits_payable", id)).toBe(0);
    expect(await checks()).toEqual([]);
    // Paying the first part clears the earliest part first.
    await new ReceiptService(accountant()).collect({ studentId: id, methods: [{ method: "upi", amountPaise: 60_000, reference: "SETTLE1" }] });
    expect((await new DuesService(accountant()).report({ q: "Hard Case" })).rows[0]).toMatchObject({ due: 100_000, nextDueDate: second });
    expect(await checks()).toEqual([]);
  });

  it("is refused when the bills moved after the request, and can be withdrawn", async () => {
    const id = await newStudent(fx, "Moved Kid", { issue: false });
    await issueAll(fx, undefined);
    const svc = new SettlementService(accountant());
    const s = await svc.propose({ studentId: id, reason: "Pay later", parts: [{ dueOn: addDays(TODAY, 20), amountPaise: 220_000 }] });
    await new ReceiptService(accountant()).collect({ studentId: id, methods: [{ method: "cash", amountPaise: 1_000 }] });
    await expect(decide(fx, "fees.settlement", s.id)).rejects.toThrow(/dates add up/);
    await svc.withdraw(s.id);
    await expect(svc.withdraw(s.id)).rejects.toThrow(/nothing to withdraw/);
  });
});

describe("a student who leaves", () => {
  it("advance and deposit go against the dues, the rest is asked back as a refund, and the balance ends at zero", async () => {
    const id = await newStudent(fx, "Leaving Kid", { issue: false });
    await openingApproved(fx, csv([[await admissionNo(id), "250", "200", "300", ""]]));
    const svc = new SettlementService(accountant());
    const out = await svc.settleUp({ studentId: id, reason: "Moving to another city", method: "cash" });
    expect(out).toMatchObject({ advancePaise: 20_000, depositPaise: 5_000, stillOwedPaise: 0 });
    expect(out.refunds).toHaveLength(1);
    expect(out.refunds[0]).toMatchObject({ source: "deposit", amountPaise: 25_000, status: "pending" });
    await decide(fx, "fees.refund", out.refunds[0]!.id);
    expect((await account(id)).balance).toMatchObject({ openPaise: 0, advancePaise: 0, depositPaise: 0, netPaise: 0 });
    expect(await ledger(fx, "student_dues", id)).toBe(0);
    expect(await ledger(fx, "deposits_payable", id)).toBe(0);
    expect(await checks()).toEqual([]);
  });
});
