// Fixes from the independent review of payroll: one test per finding, each on a school of its own.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, closeDb, eq, sql, users, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, type Ctx } from "@smw/feature-kit";
import { addMonths, monthStart, todayIST } from "@smw/feature-kit/money";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { systemAccounts } from "@smw/feature-finance/chart";
import { financeApprovals } from "@smw/feature-finance/approval-handlers";
import { ApprovalService } from "@smw/feature-finance/approvals";
import { ApprovalDeskService } from "@smw/feature-finance/service";
import { balanceOf, postJournal } from "@smw/feature-finance/posting";
import { expClaims } from "@smw/feature-expenses/schema";
import { staffProfiles } from "@smw/feature-staff/schema";
import { payConfigInput } from "./config";
import { payItems } from "./schema";
import { RateBook } from "./rate-book";
import {
  AssignmentService, DeclarationService, ExitService, LoanService, PayConfigService, PayoutService, ProfileService, ReportService, RunService, StructureService, payrollApprovals,
} from "./service";

let a: TestSchool;
const M0 = monthStart(todayIST());
const month = (back: number) => addMonths(M0, -back);
const handlers = { ...financeApprovals, ...payrollApprovals };
const ids: Record<string, string> = {};
let structureId = "", admin2: Ctx;
const maker = (ctx: Ctx = a.as.accountant) => new RunService(ctx);
const decider = (who: Ctx = a.as.admin) => new ApprovalService(who, handlers);
const bal = (key: string) => withSchool(a.id, async (tx) => balanceOf(tx, [(await systemAccounts(tx, a.id))[key as "cash"]]));
const itemsOf = (runId: string) => withSchool(a.id, async (tx) => tx.select().from(payItems).where(eq(payItems.runId, runId)));
const netOf = async (runId: string) => (await itemsOf(runId)).filter((i) => !i.skippedReason).reduce((s, i) => s + Number(i.netPaise), 0);
const unbalanced = () => withSchool(a.id, async (tx) => [...(await tx.execute(sql`select journal_id from fin_journal_lines group by journal_id having sum(debit_paise) <> sum(credit_paise)`))]);
// Tax slabs exist for this financial year only, so tax is off except where a test is about it.
const config = (lopBasis: "calendar" | "fixed30" = "calendar", tds = false) => new PayConfigService(a.as.admin).save({ pf: true, esi: false, pt: false, tds, state: "Karnataka", lopBasis });
const rowOf = async (runId: string, userId: string) => (await maker().get(runId)).items.find((i) => i.userId === userId)!;

const mkStaff = async (key: string, name: string, o: { joined?: string; gross?: number; structure?: string } = {}) => {
  const id = await withSchool(a.id, async (tx) => {
    const [u] = await tx.insert(users).values({ schoolId: a.id, role: "teacher", loginId: `${key}-${a.slug}`, name, email: `${key}@${a.slug}.test`, passwordHash: "not-a-real-hash" }).returning();
    await tx.insert(staffProfiles).values({ schoolId: a.id, userId: u!.id, employeeId: `F-${key}`, designation: "TGT", department: "Science", joiningDate: o.joined ?? "2018-04-01", employmentType: "permanent" });
    return u!.id;
  });
  await new AssignmentService(a.as.accountant).assign({ userId: id, structureId: o.structure ?? structureId, grossPaise: o.gross ?? 4_000_000, fromDate: addMonths(M0, -20) });
  await new ProfileService(a.as.accountant).save(id, { pan: "ABCDE1234F", uan: "100200300400", bankAccount: "1234567890", ifsc: "demo0001234", bankName: "Demo Bank" });
  ids[key] = id;
  return id;
};
async function approvedRun(m: string) {
  const runs = maker(), run = await runs.create({ month: m });
  await runs.review(run.id);
  await decider().approve({ id: (await runs.submit(run.id)).id });
  return run.id;
}

beforeAll(async () => {
  ({ a } = await createSchoolPair(["finance", "staff", "payroll", "notifications"], "payfx"));
  await withSchool(a.id, (tx) => systemAccounts(tx, a.id));
  await config();
  structureId = (await new StructureService(a.as.accountant).save({ name: "Teaching", components: [
    { label: "Basic", kind: "earning", mode: "percent_of_gross", value: 5000, isBasic: true, isWage: true }, { label: "Special", kind: "earning", mode: "remainder", value: 0 }] })).id;
  for (const [k, n] of [["p1", "Asha Rao"], ["p2", "Bimal Das"]] as const) await mkStaff(k, n);
  const [u2] = await withSchool(a.id, (tx) => tx.insert(users).values({ schoolId: a.id, role: "admin", loginId: `admin2-${a.slug}`, name: "Second Admin", email: `admin2@${a.slug}.test`, passwordHash: "not-a-real-hash" }).returning());
  admin2 = { ...a.as.admin, userId: u2!.id };
});
afterAll(closeDb);

describe("1. a run approved again after a recall posts again", () => {
  it("each approval has its own accrual and each recall undoes the latest", async () => {
    const before = await bal("salary_payable");
    const runId = await approvedRun(month(1));
    const net = await netOf(runId);
    expect(await bal("salary_payable")).toBe(before - net);
    const recall = async () => decider().approve({ id: (await maker().requestRecall(runId, { reason: "Check days" })).id });
    await recall();
    expect(await bal("salary_payable")).toBe(before);
    await maker().review(runId);
    await decider().approve({ id: (await maker().submit(runId)).id });
    expect(await bal("salary_payable")).toBe(before - net);
    await recall();
    expect(await bal("salary_payable")).toBe(before);
    expect(await unbalanced()).toHaveLength(0);
  });
});

describe("5 and 7. paying out: pending only, and the account frozen at approval", () => {
  it("marking everyone paid leaves a failed transfer alone", async () => {
    const runId = await approvedRun(month(2));
    const pay = new PayoutService(a.as.accountant);
    const [first] = await itemsOf(runId);
    await pay.markFailed(runId, { itemIds: [first!.id], reason: "Account closed" });
    expect((await pay.markPaid(runId)).paid).toBe(1);
    expect((await itemsOf(runId)).find((i) => i.id === first!.id)!.payout).toBe("failed");
  });

  it("a changed account stops the bank file and the payout until someone else confirms it; the audit has old and new last four", async () => {
    const runId = await approvedRun(month(3));
    const pay = new PayoutService(a.as.accountant);
    expect((await pay.bankFile(runId)).csv).toContain("1234567890");
    await new ProfileService(a.as.accountant).save(ids.p1!, { bankAccount: "9988776655", ifsc: "demo0009999" });
    await expect(pay.bankFile(runId)).rejects.toThrow(/Asha Rao.*7890.*6655/);
    const asha = (await itemsOf(runId)).find((i) => i.userId === ids.p1)!;
    await expect(pay.markPaid(runId, { itemIds: [asha.id] })).rejects.toBeInstanceOf(ConflictError);
    expect((await rowOf(runId, ids.p1!)).bankMoved).toContain("6655");
    await pay.confirmBank(runId, asha.id);
    expect((await pay.bankFile(runId)).csv).toContain("9988776655");
    const logs = await withSchool(a.id, (tx) => tx.select().from(auditLogs).where(eq(auditLogs.action, "bank_change")));
    expect(JSON.stringify(logs.map((l) => l.meta))).toContain("7890");
    expect(JSON.stringify(logs)).not.toMatch(/1234567890|9988776655/);
    // The next run flags the account changed in the last 30 days.
    const next = await maker().create({ month: month(4) });
    expect((await maker().get(next.id)).warnings.some((w) => w.code === "bank_changed" && w.message.startsWith("Asha Rao"))).toBe(true);
    await maker().cancel(next.id);
  });

  it("nobody changes their own bank details, adds to their own pay or marks their own salary paid", async () => {
    const self: Ctx = { ...a.as.accountant, userId: ids.p2! };
    await expect(new ProfileService(self).save(ids.p2!, { bankAccount: "5555555555", ifsc: "demo0001234" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new AssignmentService(self).assign({ userId: ids.p2, structureId, grossPaise: 9_000_000, fromDate: month(0) })).rejects.toBeInstanceOf(ForbiddenError);
    const run = await maker().create({ month: month(5) });
    const item = (await maker().get(run.id)).items.find((i) => i.userId === ids.p2)!;
    await expect(new RunService(self).addAdjustment(item.id, { code: "bonus", amountPaise: 100 })).rejects.toBeInstanceOf(ForbiddenError);
    await maker().addAdjustment(item.id, { code: "bonus", amountPaise: 100 });
    await maker().cancel(run.id);
    const approved = await approvedRun(month(6));
    const mine = (await itemsOf(approved)).find((i) => i.userId === ids.p2)!;
    await expect(new PayoutService(self).markPaid(approved, { itemIds: [mine.id] })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("4. a month valued as 30 days", () => {
  it("a person who joins mid-month is paid for their part of it, and the old 'working days' choice reads as the calendar", async () => {
    expect(payConfigInput.parse({ pf: true, esi: false, pt: false, lwf: false, tds: true, lopBasis: "working" }).lopBasis).toBe("calendar");
    const m = month(8), joiner = await mkStaff("j1", "Joiner One", { joined: `${m.slice(0, 7)}-16` });
    await config("fixed30");
    const run = await maker().create({ month: m });
    const dim = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
    const worked = Math.round(((dim - 15) * 30) / dim);
    expect((await rowOf(run.id, joiner)).grossPaise).toBe(Math.round((4_000_000 * worked) / 30));
    expect((await rowOf(run.id, ids.p1!)).grossPaise).toBe(4_000_000);
    await maker().cancel(run.id);
    await config();
  });
});

describe("9 and 11. an extra payment", () => {
  it("pays and deducts nothing from the structure, and withholds tax only on itself", async () => {
    const q = await mkStaff("q1", "Quentin Roy", { structure: (await new StructureService(a.as.accountant).save({ name: "Allowances", components: [
      { label: "Basic", kind: "earning", mode: "percent_of_gross", value: 5000, isBasic: true, isWage: true }, { label: "Conveyance", kind: "earning", mode: "fixed", value: 200_000, proRata: false },
      { label: "Special", kind: "earning", mode: "remainder", value: 0 }, { label: "Union fee", kind: "deduction", mode: "fixed", value: 50_000, proRata: false }] })).id });
    const runs = maker();
    const monthly = await runs.create({ month: month(9) });
    expect((await rowOf(monthly.id, q)).grossPaise).toBe(4_000_000);
    await runs.cancel(monthly.id);
    const off = await runs.create({ month: month(9), kind: "off_cycle", userIds: [q], label: "Bonus" });
    const item = (await runs.get(off.id)).items[0]!;
    expect([item.grossPaise, item.deductionsPaise]).toEqual([0, 0]);
    await runs.addAdjustment(item.id, { code: "bonus", amountPaise: 100_000 });
    expect((await runs.get(off.id)).items[0]).toMatchObject({ grossPaise: 100_000, deductionsPaise: 0, netPaise: 100_000 });
    await runs.cancel(off.id);
  });
});

describe("12. a tax declaration counts only once the office accepts it", () => {
  it("not before, audited with old and new figures, and a change takes the acceptance away", async () => {
    const teacher: Ctx = { ...a.as.accountant, userId: ids.p1!, role: "teacher", grants: new Set(["payroll:self"]) };
    await config("calendar", true);
    const mine = new DeclarationService(teacher), office = new DeclarationService(a.as.accountant);
    const income = async () => (await new DeclarationService({ ...a.as.accountant, userId: ids.p1! }).estimate())!.yearlyIncomePaise;
    const base = await income();
    await mine.save({ previousSalaryPaise: 50_000_000, previousTdsPaise: 1_000_000 });
    expect(await income()).toBe(base);
    expect((await mine.get())!.acceptedAt).toBeNull();
    await expect(new DeclarationService({ ...a.as.accountant, userId: ids.p1! }).accept(ids.p1!)).rejects.toBeInstanceOf(ForbiddenError);
    await office.accept(ids.p1!);
    expect(await income()).toBe(base + 50_000_000);
    await mine.save({ previousSalaryPaise: 60_000_000 });
    expect((await mine.get())!.acceptedAt).toBeNull();
    await office.sendBack(ids.p1!, "Attach the form 16");
    expect((await mine.get())!.returnedNote).toBe("Attach the form 16");
    const logs = await withSchool(a.id, (tx) => tx.select().from(auditLogs).where(eq(auditLogs.action, "declare")));
    expect(JSON.stringify(logs.map((l) => l.meta))).toContain("50000000");
    await config();
  });
});

describe("17. a rate before it exists is asked for", () => {
  it("the book names the missing rule and a run for that month is blocked until it is added", async () => {
    const book = await withSchool(a.id, (tx) => RateBook.load(tx));
    const on = { pf: true, esi: true, pt: false, lwf: false, tds: false };
    expect(book.forMonth("2025-10-01", { state: null, regime: "new", config: on }).rates.missing).toContain("wage_exclusion_bp");
    expect(book.forMonth("2016-12-01", { state: null, regime: "new", config: on }).rates.missing).toContain("esi_ceiling");
    expect(book.forMonth(month(1), { state: null, regime: "new", config: on }).rates.missing).toEqual([]);
    const run = await maker().create({ month: "2025-10-01" });
    expect((await maker().get(run.id)).blockers.some((b) => /wage exclusion/.test(b.message))).toBe(true);
    await expect(maker().review(run.id)).rejects.toBeInstanceOf(ConflictError);
    await maker().cancel(run.id);
  });
});

describe("6. who may not approve, and what a refusal leaves behind", () => {
  it("whoever made the run or typed an amount on it cannot approve it", async () => {
    const runs = maker(), run = await runs.create({ month: month(7) });
    const item = (await runs.get(run.id)).items[0]!;
    await new RunService(admin2).addAdjustment(item.id, { code: "bonus", amountPaise: 5_000 });
    await runs.review(run.id);
    const ap = await runs.submit(run.id);
    await expect(decider(admin2).approve({ id: ap.id })).rejects.toBeInstanceOf(ForbiddenError);
    await decider().reject({ id: ap.id, note: "Not now" });
    expect((await runs.get(run.id)).run.status).toBe("draft");
    await runs.cancel(run.id);
  });

  it("a loan is not approved by its borrower or maker; a refused loan does not block a new one", async () => {
    const loans = new LoanService(a.as.accountant);
    const { loan, approvalId } = await loans.request({ userId: ids.p1, amountPaise: 100_000, emiPaise: 50_000, startsOn: month(0), reason: "Fees" });
    await withSchool(a.id, async (tx) => {
      const involved = await payrollApprovals["payroll.loan"]!.involved!(tx, { refId: loan.id } as never);
      expect(involved).toEqual([ids.p1, a.users.accountant]);
    });
    await decider().reject({ id: approvalId, note: "No" });
    expect((await loans.get(loan.id)).loan.status).toBe("rejected");
    await loans.request({ userId: ids.p1, amountPaise: 100_000, emiPaise: 50_000, startsOn: month(0), reason: "Fees again" });
  });

  it("a refused or withdrawn exit can be changed and sent again", async () => {
    const id = await mkStaff("x9", "Xavier Nair", { joined: "2020-01-01" });
    const exits = new ExitService(a.as.accountant);
    const lastDay = `${month(8).slice(0, 7)}-20`;
    const x = await exits.create({ userId: id, lastDay, reason: "Moving" });
    await withSchool(a.id, async (tx) => expect(await payrollApprovals["payroll.exit"]!.involved!(tx, { refId: x.id } as never)).toEqual([id, a.users.accountant]));
    await decider().reject({ id: (await exits.submit(x.id)).id, note: "Check dues" });
    expect((await exits.get(x.id)).exit.status).toBe("rejected");
    await expect(exits.create({ userId: id, lastDay, reason: "Again" })).rejects.toBeInstanceOf(ConflictError);
    await exits.update(x.id, { lastDay, reason: "Moving abroad" });
    const ap = await exits.submit(x.id);
    await new ApprovalDeskService(a.as.accountant, handlers).withdraw(ap.id);
    expect((await exits.get(x.id)).exit.status).toBe("draft");
    await exits.remove(x.id);
  });
});

describe("2 and 3. final settlements", () => {
  const claim = (userId: string) => withSchool(a.id, async (tx) => {
    const sys = await systemAccounts(tx, a.id);
    const [c] = await tx.insert(expClaims).values({ schoolId: a.id, userId, title: "Train fare", spentOn: todayIST(), amountPaise: 100_000, status: "approved", payWith: "salary", accountId: sys.general_expense }).returning();
    await postJournal(tx, { schoolId: a.id, userId: a.users.admin }, { date: todayIST(), sourceKey: `test:claim:${c!.id}`, sourceType: "exp_claim", memo: "Claim", lines: [{ account: "general_expense", debit: 100_000 }, { account: "claims_payable", credit: 100_000, party: { type: "staff", id: userId } }] });
    return c!.id;
  });
  const lineCodes = async (runId: string, userId: string) => (await maker().item((await rowOf(runId, userId)).id)).lines.map((l) => l.code);

  it("an exit with an open claim can be approved and pays it; a draft exit and a run do not both take the claim", async () => {
    const leaver = await mkStaff("l1", "Leila Khan", { joined: "2019-02-15" }), claimId = await claim(leaver);
    const exits = new ExitService(a.as.accountant);
    const x = await exits.create({ userId: leaver, lastDay: `${month(11).slice(0, 7)}-10`, reason: "Moving" });
    expect((await exits.get(x.id)).exit.lines.find((l) => l.code === "claim")?.refId).toBe(claimId);
    const run = await maker().create({ month: month(11) });
    expect(await lineCodes(run.id, leaver)).not.toContain("claim");
    const ap = await exits.submit(x.id);
    await expect(decider().approve({ id: ap.id })).rejects.toThrow(/already pays/);
    await maker().cancel(run.id);
    await decider().approve({ id: ap.id });
    expect((await withSchool(a.id, (tx) => tx.select().from(expClaims).where(eq(expClaims.id, claimId))))[0]).toMatchObject({ status: "paid", payrollRef: (await exits.get(x.id)).exit.runId });
    expect(await unbalanced()).toHaveLength(0);
  });

  it("after a settlement a monthly run does not pay the leaver again", async () => {
    const leaver = await mkStaff("l2", "Mohan Pillai", { joined: "2019-02-15" });
    const exits = new ExitService(a.as.accountant);
    const x = await exits.create({ userId: leaver, lastDay: `${month(10).slice(0, 7)}-12`, reason: "Moving" });
    await decider().approve({ id: (await exits.submit(x.id)).id });
    for (const m of [month(10), month(0)]) {
      const run = await maker().create({ month: m });
      const v = await maker().get(run.id);
      expect(v.items.some((i) => i.userId === leaver)).toBe(false);
      expect(v.notIncluded.find((n) => n.userId === leaver)?.why).toBe("Paid in their final settlement");
      await maker().cancel(run.id);
    }
  });

  it("when the month's run already pays the leaver, the run is cut at the last day", async () => {
    const leaver = await mkStaff("l3", "Nisha Verma", { joined: "2019-02-15" });
    const m = month(9), run = await maker().create({ month: m });
    expect((await rowOf(run.id, leaver)).grossPaise).toBe(4_000_000);
    const exits = new ExitService(a.as.accountant);
    const x = await exits.create({ userId: leaver, lastDay: `${m.slice(0, 7)}-10`, reason: "Moving" });
    expect((await exits.get(x.id)).exit.lines.some((l) => l.code === "info")).toBe(true);
    await decider().approve({ id: (await exits.submit(x.id)).id });
    await maker().recompute(run.id);
    const dim = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
    expect((await rowOf(run.id, leaver)).grossPaise).toBe(Math.round((4_000_000 * 10) / dim));
    await maker().cancel(run.id);
  });
});

describe("18 and 20. numbers in files, and the checks at approval", () => {
  it("only payroll managers get full identity numbers and the PF return file", async () => {
    const readOnly: Ctx = { ...a.as.accountant, grants: new Set(["payroll:read"]) };
    await expect(new ReportService(readOnly).ecr(month(3))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new ReportService(a.as.accountant).ecr(month(3))).text).toContain("100200300400");
  });

  it("a typed amount for a charge that no longer applies is dropped, so it cannot unbalance the books", async () => {
    await new PayConfigService(a.as.admin).save({ pf: true, esi: false, pt: true, tds: false, state: "Kerala" });
    const runs = maker(), run = await runs.create({ month: month(0) });
    const item = await rowOf(run.id, ids.p1!);
    await runs.setTyped(item.id, "pt", 20_000);
    expect((await runs.item(item.id)).lines.some((l) => l.code === "pt" && l.amountPaise === 20_000)).toBe(true);
    await config();
    await runs.recompute(run.id);
    const after = await runs.item(item.id);
    expect(after.lines.some((l) => l.code === "pt")).toBe(false);
    expect(after.item.netPaise).toBe(after.item.grossPaise - after.item.deductionsPaise);
    await runs.cancel(run.id);
  });

  it("a person who lost their bank account after review cannot be approved", async () => {
    const runs = maker(), run = await runs.create({ month: month(0) });
    await runs.review(run.id);
    const ap = await runs.submit(run.id);
    await withSchool(a.id, (tx) => tx.execute(sql`update pay_profiles set bank_sealed = null where user_id = ${ids.p2}`));
    await expect(decider().approve({ id: ap.id })).rejects.toThrow(/no bank account/);
    await withSchool(a.id, (tx) => tx.execute(sql`update pay_profiles set bank_sealed = 'x' where user_id = ${ids.p2}`));
    await decider().reject({ id: ap.id, note: "Fix" });
    await runs.cancel(run.id);
  });
});
