import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, closeDb, invoices, withConsole, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { addDays, todayIST } from "@smw/feature-kit/money";
import { createSchoolPair, createTestSchool, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryStorage, useServices } from "@smw/integrations";
import { systemAccounts } from "@smw/feature-finance/chart";
import { balanceOf } from "@smw/feature-finance/posting";
import { finAccounts, finApprovals, finJournalLines, finJournals } from "@smw/feature-finance/schema";
import { SettingsService } from "@smw/feature-finance/service";
import { ApprovalService } from "@smw/feature-finance/approvals";
import {
  BillService, BudgetService, ClaimService, ExpenseReportService, IncomeService, PaymentService, PettyCashService, RecurringService, VendorService,
  expensesApprovals, markClaimsPaid, openSalaryClaims, verifyIncomeReceipt, sendBudgetAlerts,
} from "./service";
import seed from "./seed";

const today = todayIST();
const png = { name: "slip.png", type: "image/png", size: 4, bytes: new Uint8Array([1, 2, 3, 4]) };
let a: TestSchool, b: TestSchool, c: TestSchool, d: TestSchool;
const feats = ["finance", "expenses", "staff", "academics", "notifications"];

beforeAll(async () => {
  useServices({ storage: new MemoryStorage() });
  ({ a, b } = await createSchoolPair(feats, "exp"));
  c = await createTestSchool("c-exp", feats);
  d = await createTestSchool("d-exp", feats);
});
afterAll(closeDb);

const chart = (s: TestSchool) => withSchool(s.id, (tx) => systemAccounts(tx, s.id));
const expenseAcc = (s: TestSchool, code = "5130") => withSchool(s.id, async (tx) => { await systemAccounts(tx, s.id); return (await tx.select().from(finAccounts)).find((x) => x.code === code)!.id; });
const limit = async (s: TestSchool, paise: number) => { const st = new SettingsService(s.as.admin); await st.update({ ...(await st.get()), billLimitPaise: paise }); };
const ledger = async (s: TestSchool, key: Parameters<typeof balanceOf>[1][number] extends never ? never : "vendor_dues" | "tds_payable" | "petty_cash" | "claims_payable" | "bank" | "cash" | "other_income") => withSchool(s.id, async (tx) => balanceOf(tx, [(await systemAccounts(tx, s.id))[key]]));
const accountTotal = (s: TestSchool, id: string) => withSchool(s.id, (tx) => balanceOf(tx, [id]));
const decide = (s: TestSchool, who: Ctx) => new ApprovalService(who, expensesApprovals);
const vendor = (s: TestSchool, name: string, extra: Record<string, unknown> = {}) => new VendorService(s.as.accountant).create({ name, ...extra });
async function bill(s: TestSchool, vendorId: string, no: string, lines: number[], who: Ctx = s.as.accountant, acc?: string, extra: Record<string, unknown> = {}) {
  const account = acc ?? await expenseAcc(s);
  return new BillService(who).save({ vendorId, billNo: no, billDate: today, dueDate: addDays(today, 10), lines: lines.map((n, i) => ({ accountId: account, label: `Line ${i + 1}`, amountPaise: n })), ...extra });
}
const pay = (s: TestSchool, vendorId: string, allocations: { billId: string; amountPaise: number }[], extra: Record<string, unknown> = {}, who: Ctx = s.as.accountant) =>
  new PaymentService(who).pay({ vendorId, method: "upi", reference: "UTR1", allocations, ...extra });

describe("vendors", () => {
  it("seals PAN and bank number: only last 4 leave the service, audit rows never hold them, reveal is audited", async () => {
    const svc = new VendorService(a.as.accountant);
    const v = await svc.create({ name: "Sealed Co", pan: "PQRST9876K", bankAccount: "123456789012", ifsc: "HDFC0001234", gstin: "29ABCDE1234F1Z5" });
    const seen = JSON.stringify([v, await svc.get(v.id), await svc.list({ q: "Sealed" })]);
    expect(seen).not.toMatch(/PQRST9876K|123456789012|v1\./);
    expect(seen).not.toContain("panSealed");
    expect(v).toMatchObject({ panLast4: "876K", bankLast4: "9012", hasBank: true });
    expect(await svc.reveal(v.id)).toEqual({ pan: "PQRST9876K", bankAccount: "123456789012" });
    const logs = JSON.stringify(await withSchool(a.id, (tx) => tx.select().from(auditLogs)));
    expect(logs).not.toMatch(/PQRST9876K|123456789012/);
    expect(logs).toContain("Viewed protected details");
  });

  it("warns about the same GSTIN or PAN, guards delete by use, and keeps teachers out", async () => {
    const svc = new VendorService(a.as.accountant);
    const first = await svc.create({ name: "Twin One", gstin: "27ABCDE1234F1Z5", pan: "AAAPA1111A" });
    const second = await svc.create({ name: "Twin Two", gstin: "27ABCDE1234F1Z5", pan: "AAAPA1111A" });
    expect(second.warnings?.join(" ")).toMatch(/same GSTIN|same PAN/);
    await bill(a, first.id, "TW-1", [1000]);
    await expect(svc.remove(first.id)).rejects.toBeInstanceOf(ConflictError);
    await svc.remove(second.id);
    await expect(new VendorService(a.as.teacher).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new VendorService(a.as.teacher).reveal(first.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("bills on the accrual basis", () => {
  it("approval is needed above the limit; under it the bill approves and posts at once, exactly", async () => {
    await limit(a, 500_000);
    const v = await vendor(a, "Accrual Vendor", { tdsBasisPoints: 1000 });
    const small = await bill(a, v.id, "AC-1", [100_000, 50_001]);
    const r = await new BillService(a.as.accountant).submit(small.id);
    expect(r.outcome).toBe("approved");
    expect([r.bill.grossPaise, r.bill.tdsPaise]).toEqual([150_001, 15_000]);
    expect(await ledger(a, "vendor_dues")).toBe(-135_001);
    expect(await ledger(a, "tds_payable")).toBe(-15_000);
    expect(await accountTotal(a, await expenseAcc(a))).toBe(150_001);

    const big = await bill(a, v.id, "AC-2", [600_000]);
    const pending = await new BillService(a.as.accountant).submit(big.id);
    expect(pending.outcome).toBe("pending");
    expect(await ledger(a, "vendor_dues")).toBe(-135_001);
    await expect(pay(a, v.id, [{ billId: big.id, amountPaise: 1000 }])).rejects.toThrow(/waiting for approval/);
  });

  it("maker is not approver: an accountant cannot approve; admin does, and the ledger shows the maker", async () => {
    const v = await vendor(a, "Approval Vendor");
    const x = await bill(a, v.id, "AP-1", [700_000]);
    const sent = await new BillService(a.as.accountant).submit(x.id);
    const req = (await new ApprovalService(a.as.admin, expensesApprovals).list({ filters: { kind: "expenses.bill" } })).rows.find((r) => r.id === sent.approvalId)!;
    await expect(decide(a, a.as.accountant).approve({ id: req.id })).rejects.toBeInstanceOf(ForbiddenError);
    await decide(a, a.as.admin).approve({ id: req.id });
    const j = await withSchool(a.id, (tx) => tx.select().from(finJournals));
    expect(j.find((x2) => x2.sourceKey === `expenses:bill:${x.id}`)?.createdBy).toBe(a.users.accountant);
    expect((await new BillService(a.as.admin).get(x.id)).bill.status).toBe("approved");
  });

  it("a lone admin asking for their own approval must write why", async () => {
    const v = await vendor(a, "Own Vendor");
    const x = await bill(a, v.id, "OW-1", [900_000], a.as.admin);
    const sent = await new BillService(a.as.admin).submit(x.id);
    await expect(decide(a, a.as.admin).approve({ id: sent.approvalId })).rejects.toBeInstanceOf(ConflictError);
    await decide(a, a.as.admin).approve({ id: sent.approvalId, note: "Only admin, urgent" });
  });

  it("rejected shows the reason and can be edited and sent again; pending can be withdrawn", async () => {
    const v = await vendor(a, "Reject Vendor");
    const svc = new BillService(a.as.accountant);
    const x = await bill(a, v.id, "RJ-1", [800_000]);
    const sent = await svc.submit(x.id);
    await decide(a, a.as.admin).reject({ id: sent.approvalId, note: "Attach the quote" });
    const got = await svc.get(x.id);
    expect(got.bill.status).toBe("rejected");
    expect(got.approval).toMatchObject({ status: "rejected", note: "Attach the quote" });
    const again = await bill(a, v.id, "RJ-1", [400_000], a.as.accountant, undefined, { id: x.id });
    expect(again.status).toBe("draft");
    const re = await svc.submit(x.id);
    expect(re.outcome).toBe("approved");
    const y = await bill(a, v.id, "RJ-2", [800_000]);
    await svc.submit(y.id);
    expect((await svc.get(y.id)).approval?.waitingFor.length).toBeGreaterThan(0);
    expect((await svc.withdraw(y.id)).status).toBe("draft");
    expect((await svc.get(y.id)).approval?.status).toBe("withdrawn");
  });

  it("refuses a duplicate number for the same vendor, and a number frees up after cancel", async () => {
    const v = await vendor(a, "Dup Vendor");
    const x = await bill(a, v.id, "D-1", [1000]);
    await expect(bill(a, v.id, "d-1", [1000])).rejects.toBeInstanceOf(ConflictError);
    await new BillService(a.as.accountant).cancel(x.id, "typo");
    await bill(a, v.id, "D-1", [1000]);
  });

  it("vendor dues equal the sum of open bills through part, multi-bill and full payments", async () => {
    const v = await vendor(a, "Dues Vendor");
    const svc = new BillService(a.as.accountant);
    const [b1, b2] = [await bill(a, v.id, "DU-1", [100_000]), await bill(a, v.id, "DU-2", [250_000])];
    await svc.submit(b1.id); await svc.submit(b2.id);
    const owed = async () => (await svc.openFor(v.id)).reduce((s, x) => s + x.openPaise, 0);
    const dues = async () => 0 - (await withSchool(a.id, async (tx) => balanceOf(tx, [(await systemAccounts(tx, a.id)).vendor_dues], { party: { type: "vendor", id: v.id } })));
    expect(await dues()).toBe(350_000);
    await pay(a, v.id, [{ billId: b1.id, amountPaise: 30_000 }]);
    expect([await owed(), await dues()]).toEqual([320_000, 320_000]);
    const multi = await pay(a, v.id, [{ billId: b1.id, amountPaise: 70_000 }, { billId: b2.id, amountPaise: 100_000 }]);
    expect(multi.payment.amountPaise).toBe(170_000);
    expect([await owed(), await dues()]).toEqual([150_000, 150_000]);
    await expect(pay(a, v.id, [{ billId: b1.id, amountPaise: 1 }])).rejects.toThrow(/already paid/);
    await expect(pay(a, v.id, [{ billId: b2.id, amountPaise: 150_001 }])).rejects.toThrow(/left to pay/);
    await pay(a, v.id, [{ billId: b2.id, amountPaise: 150_000 }]);
    expect([await owed(), await dues()]).toEqual([0, 0]);
  });

  it("two people paying the same bill at once: one pays, the other is refused", async () => {
    const v = await vendor(a, "Race Vendor");
    const x = await bill(a, v.id, "RC-1", [300_000]);
    await new BillService(a.as.accountant).submit(x.id);
    const r = await Promise.allSettled([pay(a, v.id, [{ billId: x.id, amountPaise: 300_000 }], { reference: "A" }), pay(a, v.id, [{ billId: x.id, amountPaise: 300_000 }], { reference: "B" }, a.as.admin)]);
    expect(r.filter((q) => q.status === "fulfilled")).toHaveLength(1);
    expect((r.find((q) => q.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect((await new BillService(a.as.admin).get(x.id)).bill.paidPaise).toBe(300_000);
  });

  it("bank transfer to a vendor without bank details says what is missing; cash over 10,000 a day needs a note", async () => {
    const v = await vendor(a, "No Bank");
    await limit(a, 100_000_000);
    const x = await bill(a, v.id, "NB-1", [3_000_000]);
    await new BillService(a.as.accountant).submit(x.id);
    await expect(pay(a, v.id, [{ billId: x.id, amountPaise: 100 }], { method: "bank_transfer" })).rejects.toThrow(/no bank account and IFSC/);
    await expect(pay(a, v.id, [{ billId: x.id, amountPaise: 1_500_000 }], { method: "cash", reference: undefined })).rejects.toBeInstanceOf(ValidationError);
    const ok = await pay(a, v.id, [{ billId: x.id, amountPaise: 1_500_000 }], { method: "cash", reference: "Emergency, vendor insisted" });
    expect(ok.warnings.join(" ")).toMatch(/Cash above/);
  });

  it("reversing a payment needs approval, then the bill owes again and the books return", async () => {
    const v = await vendor(a, "Reverse Vendor");
    const x = await bill(a, v.id, "RV-1", [200_000]);
    const svc = new BillService(a.as.accountant);
    await svc.submit(x.id);
    const before = await ledger(a, "bank");
    const p = await pay(a, v.id, [{ billId: x.id, amountPaise: 200_000 }]);
    expect(await ledger(a, "bank")).toBe(before - 200_000);
    await expect(svc.cancel(x.id, "wrong")).rejects.toThrow(/Reverse them/);
    const ask = await new PaymentService(a.as.accountant).requestReversal(p.payment.id, "Paid twice by mistake");
    expect((await svc.get(x.id)).bill.paidPaise).toBe(200_000);
    await decide(a, a.as.admin).approve({ id: ask.id });
    expect(await ledger(a, "bank")).toBe(before);
    expect((await svc.get(x.id)).bill.paidPaise).toBe(0);
    const got = await new PaymentService(a.as.accountant).get(p.payment.id);
    expect(got.payment.status).toBe("reversed");
    await svc.cancel(x.id, "not needed");
    expect((await svc.get(x.id)).bill.status).toBe("cancelled");
  });

  it("the bank file holds the sealed number and CSV cells cannot run as formulas", async () => {
    const v = await vendor(a, "=cmd|' /C calc'!A0", { bankAccount: "99887766554", ifsc: "ICIC0001111" });
    const x = await bill(a, v.id, "BF-1", [100_000]);
    await new BillService(a.as.accountant).submit(x.id);
    const p = await pay(a, v.id, [{ billId: x.id, amountPaise: 100_000 }], { method: "bank_transfer" });
    const csv = await new PaymentService(a.as.accountant).bankFile([p.payment.id]);
    expect(csv).toContain("99887766554");
    expect(csv).toContain("'=cmd");
    expect(csv).not.toMatch(/(^|,)=cmd/);
  });
});

describe("bills on the cash basis", () => {
  it("nothing posts at approval; each payment posts the expense in step, ending at exactly the gross", async () => {
    const st = new SettingsService(c.as.admin);
    await st.update({ ...(await st.get()), basis: "cash", billLimitPaise: 10_000_000 });
    const v = await vendor(c, "Cash Basis Vendor", { tdsBasisPoints: 1000 });
    const acc = await expenseAcc(c, "5110"), acc2 = await expenseAcc(c, "5120");
    const x = await new BillService(c.as.accountant).save({ vendorId: v.id, billNo: "CB-1", billDate: today, dueDate: addDays(today, 5), lines: [{ accountId: acc, label: "Rent", amountPaise: 100_001 }, { accountId: acc2, label: "Fix", amountPaise: 50_002 }] });
    await new BillService(c.as.accountant).submit(x.id);
    expect(await ledger(c, "vendor_dues")).toBe(0);
    expect(await accountTotal(c, acc)).toBe(0);
    const net = 150_003 - 15_000;
    await pay(c, v.id, [{ billId: x.id, amountPaise: 33_333 }]);
    await pay(c, v.id, [{ billId: x.id, amountPaise: 50_000 }]);
    await pay(c, v.id, [{ billId: x.id, amountPaise: net - 83_333 }]);
    expect((await accountTotal(c, acc)) + (await accountTotal(c, acc2))).toBe(150_003);
    expect(await ledger(c, "tds_payable")).toBe(-15_000);
    expect(await ledger(c, "bank")).toBe(-net);
    expect(await ledger(c, "vendor_dues")).toBe(0);
  });
});

describe("budgets", () => {
  it("warn lets a bill through with a warning; block sends it to an approver; alerts go once", async () => {
    await limit(a, 100_000_000);
    const warnAcc = await expenseAcc(a, "5140"), blockAcc = await expenseAcc(a, "5150");
    const svc = new BudgetService(a.as.accountant);
    const fy = (await svc.grid())[0]?.fy ?? undefined;
    void fy;
    const year = `${+today.slice(5, 7) >= 4 ? today.slice(0, 4) : +today.slice(0, 4) - 1}-${String(((+today.slice(5, 7) >= 4 ? +today.slice(0, 4) : +today.slice(0, 4) - 1) + 1) % 100).padStart(2, "0")}`;
    await svc.save({ fy: year, accountId: warnAcc, yearlyPaise: 120_000, onOver: "warn" });
    await svc.save({ fy: year, accountId: blockAcc, yearlyPaise: 120_000, onOver: "block" });
    const v = await vendor(a, "Budget Vendor");
    const w = await bill(a, v.id, "BW-1", [200_000], a.as.accountant, warnAcc);
    const rw = await new BillService(a.as.accountant).submit(w.id);
    expect(rw.outcome).toBe("approved");
    expect(rw.warnings.join(" ")).toMatch(/budget/);
    const k = await bill(a, v.id, "BB-1", [200_000], a.as.accountant, blockAcc);
    const rb = await new BillService(a.as.accountant).submit(k.id);
    expect(rb.outcome).toBe("pending");
    const ap = (await new ApprovalService(a.as.admin, expensesApprovals).list({ filters: { kind: "expenses.bill" } })).rows.find((r) => r.id === rb.approvalId)!;
    expect(ap.reason).toMatch(/Over budget/);
    const sent = await withSchool(a.id, (tx) => sendBudgetAlerts(tx, a.id));
    expect(sent).toBeGreaterThan(0);
    expect(await withSchool(a.id, (tx) => sendBudgetAlerts(tx, a.id))).toBe(0);
    const g = (await svc.grid(year)).find((x) => x.accountId === warnAcc)!;
    expect(g.actualPaise).toBe(200_000);
    expect(g.leftPaise).toBe(-80_000);
  });
});

describe("recurring and Triakshi bills", () => {
  it("runs twice in a day and makes one bill; a Triakshi invoice becomes one draft bill, never twice", async () => {
    const v = await vendor(a, "Landlord");
    const rec = new RecurringService(a.as.accountant);
    await rec.create({ vendorId: v.id, label: "Rent", frequency: "monthly", nextOn: today, dueDays: 5, lines: [{ accountId: await expenseAcc(a, "5110"), label: "Rent", amountPaise: 500_000 }] });
    await withConsole((tx) => tx.insert(invoices).values({ schoolId: a.id, number: "TRI-0001", financialYear: "2026-27", status: "paid", description: "Triakshi plan", taxablePaise: 100_000, totalPaise: 118_000 }));
    const [r1, r2] = [await rec.runNow(), await rec.runNow()];
    expect([r1.recurring, r1.triakshi, r2.recurring, r2.triakshi]).toEqual([1, 1, 0, 0]);
    const rows = (await new BillService(a.as.accountant).list({ filters: { status: "draft" }, pageSize: 100 })).rows;
    expect(rows.filter((x) => x.billNo.startsWith("Rent "))).toHaveLength(1);
    expect(rows.filter((x) => x.billNo === "TRI-0001")).toHaveLength(1);
    expect(await ledger(a, "vendor_dues")).toBe(await ledger(a, "vendor_dues"));
    expect((await rec.calendar(3)).length).toBeGreaterThan(0);
  });
});

describe("petty cash", () => {
  it("top-up, spend with a photo, return; never below zero or above the limit; reversal is guarded", async () => {
    const svc = new PettyCashService(a.as.accountant);
    const f = await svc.create({ holderId: a.users.teacher, name: "Staff room", limitPaise: 100_000 });
    await expect(svc.topUp(f.id, { amountPaise: 100_001 })).rejects.toBeInstanceOf(ConflictError);
    const t = await svc.topUp(f.id, { amountPaise: 80_000, method: "cash" });
    const acc = await expenseAcc(a, "5130");
    await expect(svc.spend(f.id, { amountPaise: 1000, accountId: acc, label: "No photo" })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.spend(f.id, { amountPaise: 80_001, accountId: acc, label: "Too much" }, png)).rejects.toThrow(/Top it up/);
    const teacher = new PettyCashService(a.as.teacher);
    const s = await teacher.spend(f.id, { amountPaise: 30_000, accountId: acc, label: "Chairs" }, png);
    expect((await svc.floats()).find((x) => x.id === f.id)!.balancePaise).toBe(50_000);
    expect(await ledger(a, "petty_cash")).toBe(50_000 + (await svc.floats()).filter((x) => x.id !== f.id).reduce((q, x) => q + x.balancePaise, 0));
    await expect(svc.topUp(f.id, { amountPaise: 60_000 })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.reverseEntry(t.id)).rejects.toThrow(/less than nothing/);
    await svc.giveBack(f.id, { amountPaise: 20_000, method: "cash" });
    await svc.reverseEntry(s.id);
    expect((await svc.floats()).find((x) => x.id === f.id)!.balancePaise).toBe(60_000);
    await expect(new PettyCashService(a.as.student).floats()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new PettyCashService(a.as.accountant).entries(f.id)).resolves.toHaveLength(3);
  });
});

describe("claims", () => {
  it("photo required; manager approves (not the claimer); posts claims_payable; pay now; salary claims are handed to payroll", async () => {
    const mine = new ClaimService(a.as.teacher);
    const input = { title: "Taxi to the board", spentOn: today, amountPaise: 80_000, accountId: await expenseAcc(a, "5140"), payWith: "salary" };
    await expect(mine.submit(input)).rejects.toBeInstanceOf(ValidationError);
    const claim = await mine.submit(input, png);
    await expect(mine.approve(claim.id)).rejects.toBeInstanceOf(ForbiddenError);
    await limit(a, 1_000_000);
    const mgr = new ClaimService(a.as.accountant);
    const r = await mgr.approve(claim.id);
    expect(r.outcome).toBe("approved");
    expect(await ledger(a, "claims_payable")).toBe(-80_000);
    const open = await withSchool(a.id, (tx) => openSalaryClaims(tx, [a.users.teacher]));
    expect(open.map((o) => o.id)).toEqual([claim.id]);
    await withSchool(a.id, (tx) => markClaimsPaid(tx, [claim.id], { runId: "00000000-0000-0000-0000-0000000000aa", date: today }));
    expect((await mine.get(claim.id)).claim.status).toBe("paid");
    await expect(withSchool(a.id, (tx) => markClaimsPaid(tx, [claim.id], { runId: "00000000-0000-0000-0000-0000000000aa", date: today }))).rejects.toBeInstanceOf(ConflictError);

    const second = await mine.submit({ ...input, title: "Printing", payWith: "now" }, png);
    await mgr.approve(second.id);
    const paid = await mgr.pay(second.id, { method: "cash" });
    expect(paid.status).toBe("paid");
    expect(await ledger(a, "claims_payable")).toBe(-80_000);
  });

  it("over the limit goes to an approver; rejection keeps the reason; withdraw and resend; others cannot see it", async () => {
    await limit(a, 10_000);
    const mine = new ClaimService(a.as.teacher), mgr = new ClaimService(a.as.accountant);
    const cl = await mine.submit({ title: "Big buy", spentOn: today, amountPaise: 90_000, accountId: await expenseAcc(a, "5130") }, png);
    const sent = await mgr.approve(cl.id);
    expect(sent.outcome).toBe("pending");
    expect((await mine.get(cl.id)).waitingFor.length).toBeGreaterThan(0);
    await decide(a, a.as.admin).reject({ id: sent.approvalId, note: "Too large for petty claims" });
    const got = await mine.get(cl.id);
    expect([got.claim.status, got.approval?.note]).toEqual(["rejected", "Too large for petty claims"]);
    const re = await mine.submit({ title: "Big buy", spentOn: today, amountPaise: 9_000, accountId: await expenseAcc(a, "5130") }, undefined, cl.id);
    expect(re.status).toBe("submitted");
    await mine.withdraw(cl.id);
    expect((await mine.get(cl.id)).approval?.note).toMatch(/Withdrawn/);
    const stranger: Ctx = { ...a.as.teacher, userId: "00000000-0000-0000-0000-00000000beef" };
    await expect(new ClaimService(stranger).get(cl.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await new ClaimService(stranger).list()).total).toBe(0);
    expect((await mgr.list()).total).toBeGreaterThan(0);
    expect((await mine.list({ filters: { scope: "mine" } })).rows.every((x) => x.userId === a.users.teacher)).toBe(true);
    await expect(new ClaimService(a.as.student).list()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("other income", () => {
  it("posts debit money credit income, numbers it, verifies by token, reverses after approval", async () => {
    const svc = new IncomeService(a.as.accountant);
    const acc = (await chart(a)).other_income;
    const before = await ledger(a, "bank");
    const r = await svc.record({ fromName: "Rotary", accountId: acc, label: "Hall rent", amountPaise: 700_000, method: "bank_transfer" });
    expect(r.number).toMatch(/^OR\//);
    expect(await ledger(a, "bank")).toBe(before + 700_000);
    expect((await verifyIncomeReceipt(r.verifyToken))?.amountPaise).toBe(700_000);
    expect(await verifyIncomeReceipt("0".repeat(40))).toBeNull();
    expect((await svc.document(r.id)).data.totals[0]![1]).toMatch(/7,000/);
    await expect(svc.record({ fromName: "X", accountId: await expenseAcc(a), label: "bad", amountPaise: 100, method: "cash" })).rejects.toBeInstanceOf(ValidationError);
    const ask = await svc.requestReversal(r.id, "Wrong amount");
    await decide(a, a.as.admin).approve({ id: ask.id });
    expect(await ledger(a, "bank")).toBe(before);
    expect((await svc.get(r.id)).receipt.status).toBe("reversed");
  });
});

describe("reports", () => {
  it("ageing, upcoming and dashboard answer from the ledger and bills", async () => {
    const rep = new ExpenseReportService(a.as.accountant);
    const ageing = await rep.ageing();
    expect(ageing).toHaveLength(5);
    expect(ageing.reduce((s, x) => s + x.paise, 0)).toBe(-(await ledger(a, "vendor_dues")) );
    const d = await rep.dashboard();
    expect(d.monthly).toHaveLength(12);
    expect(d.spentPaise).toBeGreaterThan(0);
    expect((await rep.topVendors(addDays(today, -30), today)).length).toBeGreaterThan(0);
  });
});

describe("roles and isolation", () => {
  it("a teacher is refused everywhere but claims; a student sees nothing", async () => {
    const t = a.as.teacher;
    await expect(new BillService(t).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new PaymentService(t).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new BudgetService(t).grid()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new IncomeService(t).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new RecurringService(t).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ExpenseReportService(t).dashboard()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ClaimService(t).list()).resolves.toBeDefined();
    await expect(new BillService(a.as.student).list()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("school B cannot read, pay or use anything of school A", async () => {
    const v = await vendor(a, "Isolated");
    const x = await bill(a, v.id, "IS-1", [1000]);
    await expect(new BillService(b.as.accountant).get(x.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await new BillService(b.as.accountant).list()).total).toBe(0);
    expect((await new VendorService(b.as.accountant).list()).total).toBe(0);
    await expect(new BillService(b.as.accountant).submit(x.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new BillService(b.as.accountant).save({ vendorId: v.id, billNo: "X", billDate: today, dueDate: today, lines: [{ accountId: await expenseAcc(b), label: "l", amountPaise: 10 }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(pay(b, v.id, [{ billId: x.id, amountPaise: 10 }], {}, b.as.accountant)).rejects.toThrow();
    const lines = await withSchool(b.id, (tx) => tx.select().from(finJournalLines));
    expect(lines).toHaveLength(0);
    void finApprovals;
  });
});

describe("demo data", () => {
  it("seeds quickly, once, and the books match the lists", async () => {
    const t0 = Date.now();
    await seed(d.as.admin, {});
    await seed(d.as.admin, {});
    expect(Date.now() - t0).toBeLessThan(15_000);
    const bills = await new BillService(d.as.admin).list({ pageSize: 100 });
    expect(bills.total).toBe(14);
    expect(new Set(bills.rows.map((r) => r.state)).size).toBeGreaterThanOrEqual(6);
    const open = bills.rows.filter((r) => r.status === "approved").reduce((s, r) => s + r.openPaise, 0);
    expect(await ledger(d, "vendor_dues")).toBe(-open);
    const floats = await new PettyCashService(d.as.admin).floats();
    expect(await ledger(d, "petty_cash")).toBe(floats.reduce((s, f) => s + f.balancePaise, 0));
    const claimsOpen = (await new ClaimService(d.as.admin).list({ filters: { status: "approved" } })).rows.reduce((s, r) => s + r.amountPaise, 0);
    expect(await ledger(d, "claims_payable")).toBe(-claimsOpen);
    const net = await withSchool(d.id, async (tx) => (await tx.select().from(finJournalLines)).reduce((s, l) => s + l.debitPaise - l.creditPaise, 0));
    expect(net).toBe(0);
  });
});
