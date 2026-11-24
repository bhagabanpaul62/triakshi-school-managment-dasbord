import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs, closeDb, eq, sql, users, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { addMonths, monthEnd, monthStart, todayIST } from "@smw/feature-kit/money";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { systemAccounts } from "@smw/feature-finance/chart";
import { finAccounts, finCostCentres } from "@smw/feature-finance/schema";
import { financeApprovals } from "@smw/feature-finance/approval-handlers";
import { ApprovalService } from "@smw/feature-finance/approvals";
import { balanceOf, postJournal } from "@smw/feature-finance/posting";
import { finJournalLines, finApprovals } from "@smw/feature-finance/schema";
import { expClaims } from "@smw/feature-expenses/schema";
import { staffProfiles } from "@smw/feature-staff/schema";
import { ensureCredit, ensureTypes } from "@smw/feature-attendance/leave-ledger";
import { leaveLedger } from "@smw/feature-attendance/schema";
import jobs, { remindersFor } from "./jobs";
import { notifications } from "@smw/feature-notifications/schema";
import { payItems, payLines, payProfiles } from "./schema";
import type { DaysSource, MonthDaysRow } from "./sources";
import {
  AssignmentService, DashboardService, DeclarationService, ExitService, LoanService, PayConfigService, PayoutService, PayslipService, ProfileService, RateService,
  RemittanceService, ReportService, RunService, StructureService, payrollApprovals,
} from "./service";

let a: TestSchool, b: TestSchool;
const M0 = monthStart(todayIST());
const month = (back: number) => addMonths(M0, -back);
const handlers = { ...financeApprovals, ...payrollApprovals };
const ids: Record<string, string> = {};
let structureId = "";

const mkStaff = async (s: TestSchool, key: string, name: string, o: { joined?: string; type?: string; dept?: string } = {}) => withSchool(s.id, async (tx) => {
  const [u] = await tx.insert(users).values({ schoolId: s.id, role: "teacher", loginId: `${key}-${s.slug}`, name, email: `${key}@${s.slug}.test`, passwordHash: "not-a-real-hash" }).returning();
  await tx.insert(staffProfiles).values({ schoolId: s.id, userId: u!.id, employeeId: `E-${key}`, designation: "TGT", department: o.dept ?? "Science", joiningDate: o.joined ?? "2018-04-01", employmentType: (o.type ?? "permanent") as "permanent" });
  return u!.id;
});
const bal = async (key: Parameters<typeof balanceOf>[1][number] extends never ? never : string) => withSchool(a.id, async (tx) => balanceOf(tx, [(await systemAccounts(tx, a.id))[key as "cash"]]));
const maker = (ctx: Ctx = a.as.accountant) => new RunService(ctx);
const decider = (s = a, who: Ctx = s.as.admin) => new ApprovalService(who, handlers);

/** Make a draft run for a month with everyone, review it and have the admin approve it. */
async function approvedRun(m: string, o: { who?: Ctx; sources?: ConstructorParameters<typeof RunService>[1] } = {}) {
  const runs = new RunService(o.who ?? a.as.accountant, o.sources);
  const run = await runs.create({ month: m });
  await runs.review(run.id);
  const ap = await runs.submit(run.id);
  await decider().approve({ id: ap.id });
  return run.id;
}
const nets = (runId: string) => withSchool(a.id, async (tx) => (await tx.select().from(payItems).where(eq(payItems.runId, runId))).filter((i) => !i.skippedReason).map((i) => ({ userId: i.userId, id: i.id, net: Number(i.netPaise), gross: Number(i.grossPaise) })));
const lineSum = (itemIds: string[], code: string) => withSchool(a.id, async (tx) => (await tx.select().from(payLines).where(eq(payLines.code, code))).filter((l) => itemIds.includes(l.itemId)).reduce((s, l) => s + Number(l.amountPaise), 0));
const unbalanced = () => withSchool(a.id, async (tx) => [...(await tx.execute(sql`select journal_id from fin_journal_lines group by journal_id having sum(debit_paise) <> sum(credit_paise)`))]);

beforeAll(async () => {
  ({ a, b } = await createSchoolPair(["finance", "staff", "payroll", "notifications"], "pay"));
  ids.t = a.users.teacher;
  await withSchool(a.id, (tx) => tx.insert(staffProfiles).values({ schoolId: a.id, userId: ids.t!, employeeId: "E-t", designation: "TGT", department: "Science", joiningDate: "2018-04-01", employmentType: "permanent" }));
  for (const [k, n] of [["p1", "Asha Rao"], ["p2", "Bimal Das"], ["p3", "Chitra Iyer"]] as const) ids[k] = await mkStaff(a, k, n, { dept: k === "p3" ? "Office" : "Science" });
  await withSchool(a.id, (tx) => systemAccounts(tx, a.id));
  await new PayConfigService(a.as.admin).save({ pf: true, esi: false, pt: true, tds: true, state: "Karnataka" });
  structureId = (await new StructureService(a.as.accountant).save({ name: "Teaching", components: [
    { label: "Basic", kind: "earning", mode: "percent_of_gross", value: 5000, isBasic: true, isWage: true },
    { label: "HRA", kind: "earning", mode: "percent_of_basic", value: 4000 }, { label: "Special", kind: "earning", mode: "remainder", value: 0 }] })).id;
  const assign = new AssignmentService(a.as.accountant);
  const profiles = new ProfileService(a.as.accountant);
  for (const k of ["t", "p1", "p2", "p3"]) {
    await assign.assign({ userId: ids[k], structureId, grossPaise: 4_000_000, fromDate: addMonths(M0, -20) });
    await profiles.save(ids[k]!, { pan: "ABCDE1234F", uan: "100200300400", ...(k === "p3" ? {} : { bankAccount: "1234567890", ifsc: "demo0001234", bankName: "Demo Bank" }) });
  }
});
afterAll(closeDb);

describe("pay details", () => {
  it("sealed values never leave the service, the audit log or a list; reveal is audited", async () => {
    const svc = new ProfileService(a.as.accountant);
    const got = await svc.get(ids.p1!);
    expect(JSON.stringify(got)).not.toMatch(/ABCDE1234F|1234567890|100200300400/);
    expect(got.profile).toMatchObject({ panLast4: "234F", bankLast4: "7890", has: { pan: true, bankAccount: true } });
    expect(JSON.stringify(await svc.list({}))).not.toMatch(/ABCDE1234F|1234567890/);
    const row = await withSchool(a.id, async (tx) => (await tx.select().from(payProfiles).where(eq(payProfiles.userId, ids.p1!)))[0]!);
    expect(row.panSealed).not.toContain("ABCDE");
    expect(await svc.reveal(ids.p1!, "pan")).toBe("ABCDE1234F");
    const logs = await withSchool(a.id, (tx) => tx.select().from(auditLogs).where(eq(auditLogs.entity, "PayProfile")));
    expect(logs.some((l) => l.action === "reveal")).toBe(true);
    expect(JSON.stringify(logs)).not.toMatch(/ABCDE1234F|1234567890|100200300400/);
  });
  it("missing details are listed; teacher cannot see anyone's pay details", async () => {
    const list = await new ProfileService(a.as.accountant).list({ filters: { missing: "1" } });
    expect(list.rows.map((r) => r.name)).toEqual(["Chitra Iyer"]);
    expect(list.rows[0]!.missing.map((m) => m.code)).toEqual(["bank"]);
    await expect(new ProfileService(a.as.teacher).get(ids.p1!)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ProfileService(a.as.teacher).reveal(ids.p1!, "pan")).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("a bad PAN or IFSC is refused with the field named", async () => {
    await expect(new ProfileService(a.as.accountant).save(ids.p1!, { pan: "123" })).rejects.toBeInstanceOf(ValidationError);
    await expect(new ProfileService(a.as.accountant).save(ids.p1!, { bankAccount: "1234567890", ifsc: "BAD" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("structures and assignments", () => {
  it("a structure in use is changed by copying it; delete is refused", async () => {
    const svc = new StructureService(a.as.accountant);
    await expect(svc.save({ name: "Teaching", components: [] }, structureId)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.remove(structureId)).rejects.toBeInstanceOf(ConflictError);
    const copy = await svc.copy(structureId);
    expect(copy.name).toBe("Teaching v2");
    expect((await svc.get(copy.id)).components).toHaveLength(3);
    await svc.save({ name: "Teaching v2", components: [] }, copy.id);
    await svc.remove(copy.id);
  });
  it("component rules are checked", async () => {
    const svc = new StructureService(a.as.accountant);
    const basic = { label: "Basic", kind: "earning", mode: "fixed", value: 1000, isBasic: true };
    await expect(svc.save({ name: "Bad", components: [basic, { ...basic, label: "Basic 2" }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.save({ name: "Bad", components: [{ label: "HRA", kind: "earning", mode: "percent_of_basic", value: 4000 }] })).rejects.toBeInstanceOf(ValidationError);
  });
  it("pay history keeps every change; a future raise waits for its month; the same date twice is refused", async () => {
    const svc = new AssignmentService(a.as.accountant);
    const future = await svc.assign({ userId: ids.p2, structureId, grossPaise: 5_000_000, fromDate: addMonths(M0, 3) });
    await expect(svc.assign({ userId: ids.p2, structureId, grossPaise: 1, fromDate: addMonths(M0, 3) })).rejects.toBeInstanceOf(ConflictError);
    expect((await svc.history(ids.p2!)).map((h) => h.grossPaise)).toEqual([5_000_000, 4_000_000]);
    expect(future.fromDate > M0).toBe(true);
  });
  it("bulk raise previews, then saves; a sheet with one bad row saves nothing", async () => {
    const svc = new AssignmentService(a.as.accountant);
    const from = addMonths(M0, 5);
    const preview = await svc.bulkRaise({ percentBp: 1000, fromDate: from, userIds: [ids.p1] }, { preview: true });
    expect(preview.rows).toEqual([{ userId: ids.p1, name: "Asha Rao", oldPaise: 4_000_000, newPaise: 4_400_000 }]);
    expect((await svc.history(ids.p1!))).toHaveLength(1);
    await svc.bulkRaise({ percentBp: 1000, fromDate: from, userIds: [ids.p1] }, { preview: false });
    expect((await svc.history(ids.p1!))[0]!.grossPaise).toBe(4_400_000);
    const csv = (rows: string) => ({ name: "pay.csv", bytes: new TextEncoder().encode(`employee_id,structure,gross,from_date\n${rows}`) });
    const bad = await svc.importSheet(csv(`E-p3,Teaching,45000,${addMonths(M0, 6)}\nE-nobody,Teaching,1,${addMonths(M0, 6)}`), { commit: true });
    expect([bad.ok, bad.failed]).toEqual([1, 1]);
    expect((await svc.history(ids.p3!))).toHaveLength(1);
    expect((await svc.importSheet(csv(`E-p3,Teaching,45000,${addMonths(M0, 6)}`), { commit: true })).ok).toBe(1);
    expect((await svc.history(ids.p3!))[0]!.grossPaise).toBe(4_500_000);
  });
});

describe("run lifecycle", () => {
  it("blocks review until a missing bank is fixed; approval posts a balanced accrual; salary payable is what is unpaid", async () => {
    const m = month(1);
    const runs = maker();
    const run = await runs.create({ month: m });
    await expect(runs.create({ month: m })).rejects.toBeInstanceOf(ConflictError);
    const view = await runs.get(run.id);
    expect(view.items).toHaveLength(4);
    expect(view.blockers.map((x) => x.code)).toEqual(["bank"]);
    await expect(runs.review(run.id)).rejects.toBeInstanceOf(ConflictError);
    await new ProfileService(a.as.accountant).switchPayBy(ids.p3!, "cash");
    await runs.review(run.id);
    await expect(runs.addAdjustment(view.items[0]!.id, { code: "bonus", amountPaise: 100 })).rejects.toBeInstanceOf(ConflictError);
    const ap = await runs.submit(run.id);
    await expect(decider(a, a.as.accountant).approve({ id: ap.id })).rejects.toBeInstanceOf(ForbiddenError);
    await decider().approve({ id: ap.id });
    const done = await runs.get(run.id);
    expect(done.run.status).toBe("approved");
    expect(done.items.every((i) => i.payslipNo)).toBe(true);
    const items = await nets(run.id), net = items.reduce((s, i) => s + i.net, 0);
    expect(await bal("salary_payable")).toBe(-net);
    expect(await bal("pf_payable")).toBe(-(await lineSum(items.map((i) => i.id), "pf_employee") + await lineSum(items.map((i) => i.id), "pf_employer") + await lineSum(items.map((i) => i.id), "eps_employer") + await lineSum(items.map((i) => i.id), "edli") + await lineSum(items.map((i) => i.id), "pf_admin") + (done.totals.pfAdminTopUp ?? 0)));
    expect(await unbalanced()).toHaveLength(0);
    // Pay one person: salary payable falls by exactly their net.
    const pay = new PayoutService(a.as.accountant);
    await pay.markPaid(run.id, { itemIds: [items[0]!.id] });
    expect(await bal("salary_payable")).toBe(-(net - items[0]!.net));
    await expect(pay.markPaid(run.id, { itemIds: [items[0]!.id] })).rejects.toBeInstanceOf(ConflictError);
  });

  it("payouts: bank file, failed then retried, and the run turns paid when everyone is", async () => {
    const runId = (await maker().list({ filters: { status: "approved" } })).rows[0]!.id;
    const pay = new PayoutService(a.as.accountant);
    const file = await pay.bankFile(runId);
    expect(file.csv).toContain("1234567890");
    expect(file.csv.split("\r\n")[0]).toBe("Beneficiary name,Account number,IFSC,Amount,Narration");
    const waiting = (await maker().get(runId)).items.filter((i) => i.payout === "pending");
    await pay.markFailed(runId, { itemIds: [waiting[0]!.id], reason: "Account closed" });
    expect((await maker().get(runId)).items.find((i) => i.id === waiting[0]!.id)!.failReason).toBe("Account closed");
    await pay.markPaid(runId, { itemIds: waiting.slice(1).map((i) => i.id) });
    expect((await maker().get(runId)).run.status).toBe("approved");
    await pay.retry(runId, [waiting[0]!.id]);
    const r = await pay.markPaid(runId);
    expect(r.runPaid).toBe(true);
    expect(await bal("salary_payable")).toBe(0);
    await expect(maker().requestRecall(runId, { reason: "oops" })).rejects.toBeInstanceOf(ConflictError);
    expect(await unbalanced()).toHaveLength(0);
  });

  it("two people marking the same person paid at once pay once", async () => {
    const runId = await approvedRun(month(2));
    const [item] = await nets(runId);
    const before = await bal("salary_payable");
    const out = await Promise.allSettled([new PayoutService(a.as.accountant).markPaid(runId, { itemIds: [item!.id] }), new PayoutService(a.as.admin).markPaid(runId, { itemIds: [item!.id] })]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(await bal("salary_payable")).toBe(before + item!.net);
  });

  it("recall: only by approval, reverses everything, reopens the run; refused once anyone is paid", async () => {
    const runId = await approvedRun(month(5));
    const before = await bal("salary_payable");
    const ap = await maker().requestRecall(runId, { reason: "Wrong days" });
    expect((await maker().get(runId)).run.status).toBe("approved");
    await decider().approve({ id: ap.id });
    expect((await maker().get(runId)).run.status).toBe("draft");
    expect(await bal("salary_payable")).toBe(before + (await nets(runId)).reduce((s, i) => s + i.net, 0));
    // Fix and approve again: the payslip numbers stay.
    await maker().review(runId);
    const ap2 = await maker().submit(runId);
    await decider().approve({ id: ap2.id });
    const [first] = await nets(runId);
    await new PayoutService(a.as.accountant).markPaid(runId, { itemIds: [first!.id] });
    await expect(maker().requestRecall(runId, { reason: "late" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("adjustments, typed amounts and skipping with arrears next run", async () => {
    const runs = maker();
    const run = await runs.create({ month: month(4) });
    const v = await runs.get(run.id);
    const asha = v.items.find((i) => i.name === "Asha Rao")!, bimal = v.items.find((i) => i.name === "Bimal Das")!;
    await runs.addAdjustment(asha.id, { code: "bonus", amountPaise: 500_000, label: "Festival bonus" });
    await runs.addAdjustment(asha.id, { code: "deduction", amountPaise: 10_000 });
    const after = (await runs.get(run.id)).items.find((i) => i.id === asha.id)!;
    expect(after.grossPaise).toBe(asha.grossPaise + 500_000);
    expect(after.deductionsPaise).toBeGreaterThanOrEqual(asha.deductionsPaise + 10_000);
    expect(after.netPaise).toBe(after.grossPaise - after.deductionsPaise);
    const detail = await runs.item(asha.id);
    expect(detail.lines.find((l) => l.label === "Festival bonus")).toMatchObject({ manual: true, source: "Typed by a person" });
    await runs.removeAdjustment(detail.lines.find((l) => l.label === "Festival bonus")!.id);
    await expect(runs.skip(bimal.id, { reason: "x" })).rejects.toBeInstanceOf(ValidationError);
    await runs.skip(bimal.id, { reason: "On unpaid study leave" });
    await new ProfileService(a.as.accountant).switchPayBy(ids.p3!, "cash");
    await runs.review(run.id);
    expect((await runs.get(run.id)).totals.people).toBe(3);
    const ap = await runs.submit(run.id);
    await decider().approve({ id: ap.id });
    // The next month owes Bimal the pay left out, once.
    const next = await runs.create({ month: month(3) });
    const nextView = await runs.get(next.id);
    const b2 = nextView.items.find((i) => i.name === "Bimal Das")!;
    const lines = (await runs.item(b2.id)).lines.filter((l) => l.code === "arrears");
    expect(lines).toHaveLength(1);
    expect(lines[0]!.amountPaise).toBe(bimal.grossPaise);
    // A later run does not repeat it.
    const again = await runs.create({ month: M0 });
    expect((await runs.item((await runs.get(again.id)).items.find((i) => i.name === "Bimal Das")!.id)).lines.filter((l) => l.code === "arrears")).toHaveLength(0);
    await runs.cancel(again.id);
    await runs.cancel(next.id);
  });

  it("a rule with no row needs a typed amount before review; a low-confidence rate is named", async () => {
    await new ProfileService(a.as.accountant).save(ids.p1!, { state: "Kerala" });
    const runs = maker();
    const run = await runs.create({ month: month(6) });
    let v = await runs.get(run.id);
    const asha = v.items.find((i) => i.name === "Asha Rao")!;
    expect(v.blockers.some((x) => x.code === "typed")).toBe(true);
    await expect(runs.review(run.id)).rejects.toBeInstanceOf(ConflictError);
    await runs.setTyped(asha.id, "pt", 20_000);
    v = await runs.get(run.id);
    expect(v.blockers.some((x) => x.code === "typed")).toBe(false);
    await expect(runs.setTyped(asha.id, "tds", 1)).rejects.toBeInstanceOf(ConflictError);
    await new ProfileService(a.as.accountant).save(ids.p2!, { state: "West Bengal" });
    await runs.recompute(run.id);
    expect((await runs.get(run.id)).lowConfidence.some((r) => r.key === "pt")).toBe(true);
    await new ProfileService(a.as.accountant).save(ids.p1!, { state: "Karnataka" });
    await new ProfileService(a.as.accountant).save(ids.p2!, { state: "Karnataka" });
    await runs.cancel(run.id);
  });

  it("unmarked days block review when attendance is on; days come from the source", async () => {
    const days = (unmarked: number): MonthDaysRow => ({ calendarDays: 30, holidays: 0, sundays: 4, workingDays: 26, present: 26 - unmarked, half: 0, paidLeaveHalfDays: 0, unpaidLeaveHalfDays: 2, absentDays: 1, lateDays: 0, unmarkedDays: unmarked });
    const source: DaysSource = { monthDays: async (_tx, userIds) => Object.fromEntries(userIds.map((u) => [u, days(u === ids.p1 ? 2 : 0)])), encashable: async () => [] };
    const ctx: Ctx = { ...a.as.accountant, features: new Set([...a.as.accountant.features, "attendance"]) };
    const runs = new RunService(ctx, { days: source });
    const run = await runs.create({ month: month(7) });
    const v = await runs.get(run.id);
    expect(v.blockers.filter((x) => x.code === "unmarked")).toHaveLength(1);
    expect(v.blockers[0]!.href).toContain("/app/attendance/staff/register");
    const row = v.items.find((i) => i.name === "Asha Rao")!;
    expect([row.unpaidHalfDays, row.unmarkedDays]).toEqual([4, 2]);
    await expect(runs.setDays(row.id, { unpaidDays: 1 })).rejects.toBeInstanceOf(ConflictError);
    // 2 unpaid days (1 absent + 1 leave day) cut the gross by 2 over the days of the month.
    const cal = new Date(Date.UTC(+month(7).slice(0, 4), +month(7).slice(5, 7), 0)).getUTCDate();
    expect(row.grossPaise).toBe(Math.round((4_000_000 * (2 * cal - 4)) / (2 * cal)));
    await runs.cancel(run.id);
  });

  it("with attendance off the days are typed, and cancel refuses an approved run", async () => {
    const runs = maker();
    const run = await runs.create({ month: month(8) });
    const first = (await runs.get(run.id)).items[0]!;
    await runs.setDays(first.id, { unpaidDays: 3 });
    expect((await runs.get(run.id)).items.find((i) => i.id === first.id)!.unpaidHalfDays).toBe(6);
    await runs.cancel(run.id);
    expect((await runs.get(run.id)).run.status).toBe("cancelled");
    await expect(runs.recompute(run.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("an extra-pay run pays only what is typed", async () => {
    const runs = maker();
    const run = await runs.create({ month: month(1), kind: "off_cycle", userIds: [ids.p1], label: "Diwali bonus" });
    const item = (await runs.get(run.id)).items[0]!;
    expect(item.grossPaise).toBe(0);
    await runs.addAdjustment(item.id, { code: "bonus", amountPaise: 1_000_000 });
    expect((await runs.get(run.id)).items[0]!.netPaise).toBe(1_000_000);
    await runs.cancel(run.id);
  });
});

describe("loans", () => {
  it("request, approval, give, recovery that never passes the balance, close", async () => {
    const svc = new LoanService(a.as.accountant);
    const { loan, approvalId } = await svc.request({ userId: ids.p2, amountPaise: 500_000, emiPaise: 300_000, startsOn: month(7), reason: "Fees" });
    await expect(svc.give(loan.id)).rejects.toBeInstanceOf(ConflictError);
    await decider().approve({ id: approvalId });
    await svc.give(loan.id, {});
    await expect(svc.give(loan.id, {})).rejects.toBeInstanceOf(ConflictError);
    expect(await bal("staff_loans")).toBe(await outstanding());
    const r1 = await approvedRun(month(6));
    let d = await svc.get(loan.id);
    expect([d.recoveredPaise, d.balancePaise]).toEqual([300_000, 200_000]);
    const r2 = await approvedRun(month(7));
    d = await svc.get(loan.id);
    expect([d.recoveredPaise, d.balancePaise, d.loan.status]).toEqual([500_000, 0, "closed"]);
    const r3 = await approvedRun(month(3));
    expect((await svc.get(loan.id)).recoveredPaise).toBe(500_000);
    expect(await bal("staff_loans")).toBe(await outstanding());
    void r1; void r2; void r3;
  });
  it("pause skips recovery; a person asks for their own loan; a stranger's is hidden", async () => {
    const svc = new LoanService(a.as.accountant);
    const mine = await new LoanService(a.as.teacher).request({ amountPaise: 100_000, emiPaise: 50_000, startsOn: M0, reason: "Bike repair" });
    expect((await new LoanService(a.as.teacher).list({})).rows).toHaveLength(1);
    await expect(new LoanService(a.as.teacher).get(mine.loan.id)).resolves.toBeTruthy();
    await expect(new LoanService(a.as.teacher).request({ userId: ids.p1, amountPaise: 100_000, emiPaise: 50_000, startsOn: M0, reason: "Not mine" })).rejects.toBeInstanceOf(ForbiddenError);
    await decider().approve({ id: mine.approvalId });
    await svc.give(mine.loan.id, {});
    await svc.pause(mine.loan.id, { until: addMonths(M0, 4) });
    expect((await svc.get(mine.loan.id)).loan.status).toBe("paused");
    await svc.resume(mine.loan.id);
    const res = await svc.payBack(mine.loan.id, { amountPaise: 100_000 });
    expect(res.closed).toBe(true);
    expect(await bal("staff_loans")).toBe(await outstanding());
  });
});
/** Money still owed on every loan that was given, from the loan tables alone. */
const outstanding = () => withSchool(a.id, async (tx) => {
  const [r] = [...(await tx.execute(sql`select coalesce(sum(l.amount_paise), 0) - coalesce(sum((select coalesce(sum(p.amount_paise), 0) from pay_loan_repayments p where p.loan_id = l.id)), 0) as v from pay_loans l where l.given_on is not null`))] as { v: string }[];
  return Number(r!.v);
});

describe("claims", () => {
  it("a claim rides on salary once: claims payable clears at approval and comes back on recall", async () => {
    const claimId = await withSchool(a.id, async (tx) => {
      const sys = await systemAccounts(tx, a.id);
      const [c] = await tx.insert(expClaims).values({ schoolId: a.id, userId: ids.p1!, title: "Train fare", spentOn: todayIST(), amountPaise: 120_000, status: "approved", payWith: "salary", accountId: sys.general_expense }).returning();
      await postJournal(tx, { schoolId: a.id, userId: a.users.admin }, { date: todayIST(), sourceKey: `test:claim:${c!.id}`, sourceType: "exp_claim", memo: "Claim", lines: [{ account: "general_expense", debit: 120_000 }, { account: "claims_payable", credit: 120_000, party: { type: "staff", id: ids.p1! } }] });
      return c!.id;
    });
    const before = await bal("claims_payable");
    expect(before).toBe(-120_000);
    const runs = maker();
    const run = await runs.create({ month: M0 });
    const asha = (await runs.get(run.id)).items.find((i) => i.name === "Asha Rao")!;
    const lines = (await runs.item(asha.id)).lines;
    expect(lines.find((l) => l.code === "claim")?.amountPaise).toBe(120_000);
    // A second run for the same month cannot take the claim too.
    const extra = await runs.create({ month: M0, kind: "off_cycle", userIds: [ids.p1] });
    expect((await runs.item((await runs.get(extra.id)).items[0]!.id)).lines.some((l) => l.code === "claim")).toBe(false);
    await runs.cancel(extra.id);
    await runs.review(run.id);
    const ap = await runs.submit(run.id);
    await decider().approve({ id: ap.id });
    expect(await bal("claims_payable")).toBe(0);
    expect((await withSchool(a.id, (tx) => tx.select().from(expClaims).where(eq(expClaims.id, claimId))))[0]).toMatchObject({ status: "paid", payrollRef: run.id });
    const recall = await runs.requestRecall(run.id, { reason: "Check claim" });
    await decider().approve({ id: recall.id });
    expect(await bal("claims_payable")).toBe(-120_000);
    expect((await withSchool(a.id, (tx) => tx.select().from(expClaims).where(eq(expClaims.id, claimId))))[0]).toMatchObject({ status: "approved", payrollRef: null });
    expect(await unbalanced()).toHaveLength(0);
  });
});

describe("exit", () => {
  it("works out final pay, gratuity, notice and the loan balance; pays through its own run; undo reverses it", async () => {
    const leaver = await mkStaff(a, "x1", "Dev Menon", { joined: "2019-02-15", type: "permanent" });
    await new AssignmentService(a.as.accountant).assign({ userId: leaver, structureId, grossPaise: 4_000_000, fromDate: addMonths(M0, -20) });
    await new ProfileService(a.as.accountant).save(leaver, { pan: "ABCDE9999F", bankAccount: "99887766554", ifsc: "DEMO0001234", state: "Karnataka" });
    const loans = new LoanService(a.as.accountant);
    const l = await loans.request({ userId: leaver, amountPaise: 600_000, emiPaise: 100_000, startsOn: month(7), reason: "Advance" });
    await decider().approve({ id: l.approvalId });
    await loans.give(l.loan.id, {});
    const exits = new ExitService(a.as.accountant);
    const lastDay = `${month(7).slice(0, 7)}-15`;
    const x = await exits.create({ userId: leaver, lastDay, reason: "Moving abroad", noticeDays: -5, other: [{ kind: "earning", label: "Bonus", amountPaise: 100_000 }] });
    const v = await exits.get(x.id);
    const by = (code: string) => v.exit.lines.find((ln) => ln.code === code);
    // 7 years from 15 Feb 2019 to 15 Month/year: wage is 50% of 40,000 = 20,000; 15/26 of that for each counted year.
    const years = Number(by("gratuity")!.label.match(/(\d+) years/)![1]);
    expect(by("gratuity")!.amountPaise).toBe(Math.round((2_000_000 * 15 * years) / 26));
    expect(by("notice_recovery")).toMatchObject({ kind: "deduction", amountPaise: Math.round((4_000_000 * 5) / 30) });
    expect(by("loan")).toMatchObject({ kind: "deduction", amountPaise: 600_000 });
    expect(v.due.wages > lastDay).toBe(true);
    expect(v.due.gratuity).toBe(`${new Date(Date.parse(`${lastDay}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10)}`);
    const salary = v.exit.lines.filter((ln) => ln.kind === "earning" && !["gratuity", "other"].includes(ln.code) && ln.amountPaise > 0).reduce((s, ln) => s + ln.amountPaise, 0);
    const dim = new Date(Date.UTC(+lastDay.slice(0, 4), +lastDay.slice(5, 7), 0)).getUTCDate();
    expect(salary).toBe(Math.round((4_000_000 * 15) / dim));
    const ap = await exits.submit(x.id);
    expect((await exits.get(x.id)).exit.status).toBe("pending");
    await decider().approve({ id: ap.id });
    const done = await exits.get(x.id);
    expect(done.exit.status).toBe("approved");
    expect((await new LoanService(a.as.accountant).get(l.loan.id)).balancePaise).toBe(0);
    expect(await unbalanced()).toHaveLength(0);
    const owed = done.totals.net;
    const before = await bal("salary_payable");
    await exits.undo(x.id, { reason: "Wrong last day" });
    expect((await exits.get(x.id)).exit.status).toBe("draft");
    expect(await bal("salary_payable")).toBe(before + owed);
    expect((await new LoanService(a.as.accountant).get(l.loan.id)).balancePaise).toBe(600_000);
    // Approve again and pay: the exit becomes paid.
    const ap2 = await exits.submit(x.id);
    await decider().approve({ id: ap2.id });
    const runId = (await exits.get(x.id)).exit.runId!;
    expect((await new PayoutService(a.as.accountant).markPaid(runId)).runPaid).toBe(true);
    expect((await exits.get(x.id)).exit.status).toBe("paid");
    // The accountant cannot switch the login off, so the admins are told.
    const told = await withSchool(a.id, async (tx) => (await tx.select().from(notifications).where(eq(notifications.userId, a.users.admin))).map((n) => n.title));
    expect(told).toContain("Deactivate Dev Menon: the final pay is paid");
    expect((await exits.get(x.id)).deactivateBy.length).toBeGreaterThan(0);
    await expect(exits.update(x.id, { lastDay, reason: "again" })).rejects.toBeInstanceOf(ConflictError);
  });
  it("leave paid out at exit is written to the leave ledger, and put back when the settlement is undone", async () => {
    const id = await mkStaff(a, "x3", "Farid Khan", { joined: "2018-04-01", type: "permanent" });
    await new AssignmentService(a.as.accountant).assign({ userId: id, structureId, grossPaise: 4_000_000, fromDate: addMonths(M0, -20) });
    await new ProfileService(a.as.accountant).save(id, { pan: "ABCDE7777F", bankAccount: "11223344556", ifsc: "DEMO0001234" });
    await withSchool(a.id, async (tx) => { await ensureTypes(tx, a.id); await ensureCredit(tx, a.id, todayIST(), id); });
    const ctx: Ctx = { ...a.as.accountant, features: new Set([...a.as.accountant.features, "attendance"]) };
    const exits = new ExitService(ctx);
    const ledger = () => withSchool(a.id, async (tx) => (await tx.select().from(leaveLedger).where(eq(leaveLedger.userId, id))).reduce((s, r) => s + r.halfDays, 0));
    const before = await ledger();
    const x = await exits.create({ userId: id, lastDay: `${M0.slice(0, 7)}-15`, reason: "Retired" });
    const line = (await exits.get(x.id)).exit.lines.find((l) => l.code === "leave_encashment")!;
    const half = Number(line.note!.split(":")[1]);
    expect(half).toBeGreaterThan(0);
    expect(line.amountPaise).toBe(Math.round((4_000_000 * (half / 2)) / 30));
    await decider().approve({ id: (await exits.submit(x.id)).id });
    expect(await ledger()).toBe(before - half);
    await exits.undo(x.id, { reason: "Wrong person" });
    expect(await ledger()).toBe(before);
  });
  it("a person with an exit in progress cannot be given another", async () => {
    const id = await mkStaff(a, "x2", "Eka Nair", { type: "contract", joined: "2025-12-01" });
    await new AssignmentService(a.as.accountant).assign({ userId: id, structureId, grossPaise: 3_000_000, fromDate: addMonths(M0, -20) });
    const exits = new ExitService(a.as.accountant);
    await exits.create({ userId: id, lastDay: todayIST(), reason: "End of contract" });
    await expect(exits.create({ userId: id, lastDay: todayIST(), reason: "again" })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("statutory payments", () => {
  it("what is owed comes from the approved runs; paying clears the payable; more than owed is refused", async () => {
    const svc = new RemittanceService(a.as.accountant);
    const m = month(1);
    const row = (await svc.list()).find((r) => r.key === "pf" && r.month === m)!;
    expect(row.duePaise).toBeGreaterThan(0);
    await expect(svc.record({ key: "pf", month: m, amountPaise: row.outstandingPaise + 1 })).rejects.toBeInstanceOf(ValidationError);
    await svc.record({ key: "pf", month: m, amountPaise: row.outstandingPaise - 100, reference: "CHALLAN 1" });
    expect((await svc.list()).find((r) => r.key === "pf" && r.month === m)!.outstandingPaise).toBe(100);
    await svc.record({ key: "pf", month: m, amountPaise: 100 });
    const pt = (await svc.list()).find((r) => r.key === "pt" && r.month === m)!;
    await svc.record({ key: "pt", month: m, amountPaise: pt.outstandingPaise });
    expect((await svc.list()).find((r) => r.key === "pf" && r.month === m)!.outstandingPaise).toBe(0);
    expect(await unbalanced()).toHaveLength(0);
    await expect(new RemittanceService(a.as.teacher).list()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("payslips and reports", () => {
  it("a person sees only their own payslips; the PDF opens for them and not for others", async () => {
    const mine = await new PayslipService(a.as.teacher).list();
    expect(mine.length).toBeGreaterThan(0);
    const item = mine[0]!;
    const data = await new PayslipService(a.as.teacher).data(item.itemId);
    expect(data.data.facts.find(([k]) => k === "PAN")![1]).toBe("XXXXXX234F");
    expect(JSON.stringify(data.data)).not.toMatch(/ABCDE1234F|1234567890/);
    const pdf = await new PayslipService(a.as.teacher).pdf(item.itemId);
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 4))).toBe("%PDF");
    const others = (await new PayslipService(a.as.accountant).list(ids.p1)).map((p) => p.itemId);
    expect(others.length).toBeGreaterThan(0);
    await expect(new PayslipService(a.as.teacher).list(ids.p1)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new PayslipService(a.as.teacher).data(others[0]!)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new RunService(a.as.teacher).list({})).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new ReportService(a.as.teacher).build("statement", {})).rows.length).toBeGreaterThan(0);
    await expect(new ReportService(a.as.teacher).build("register", {})).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("registers, the PF file and the loan ledger", async () => {
    const rep = new ReportService(a.as.accountant);
    const reg = await rep.build("register", { month: month(1).slice(0, 7) });
    expect(reg.rows).toHaveLength(4);
    expect(reg.rows.reduce((s, r) => s + Number(r.net), 0)).toBeGreaterThan(0);
    const ecr = await rep.ecr(month(1));
    expect(ecr.text).toContain("100200300400#~#");
    // Wages are the stored ones: gross 40,000, wages 20,000 (basic), contributions 2,400 / 1,666 / 734.
    expect(ecr.text).toContain("#~#40000#~#20000#~#20000#~#20000#~#2400#~#1666#~#734#~#");
    expect((await rep.build("loans")).rows.length).toBeGreaterThan(0);
    expect((await rep.build("components", { by: "month" })).rows.length).toBeGreaterThan(0);
  });
  it("tax declaration: own record and an estimate; others' are closed to a teacher", async () => {
    const d = new DeclarationService(a.as.teacher);
    await d.save({ deductionsPaise: 15_000_000 });
    expect((await d.get())!.deductionsPaise).toBe(15_000_000);
    await expect(d.get(ids.p1)).rejects.toBeInstanceOf(ForbiddenError);
    const est = await d.estimate();
    expect(est === null || est.monthsLeft >= 1).toBe(true);
  });
});

describe("rates, dashboard and reminders", () => {
  it("a school's own rate beats the built-in and is named as such", async () => {
    const svc = new RateService(a.as.accountant);
    await svc.override({ key: "pf_ceiling", fromDate: "2026-01-01", value: 3_000_000, reason: "Trust deed" });
    const row = (await svc.list()).find((r) => r.key === "pf_ceiling")!;
    expect(row).toMatchObject({ overridden: true, shown: 3_000_000 });
    await expect(svc.override({ key: "pf_ceiling", fromDate: "2026-01-01", value: 1, reason: "dup" })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.override({ key: "pt", fromDate: "2026-01-01", value: "nope", reason: "bad shape" })).rejects.toBeInstanceOf(ValidationError);
    await svc.removeOverride(row.id!);
  });
  it("the dashboard names the next step and the setup checklist links to fixes", async () => {
    const d = await new DashboardService(a.as.accountant).overview();
    expect(d.next).toBeTruthy();
    expect(d.setup.every((s) => s.href.startsWith("/app/"))).toBe(true);
    expect(d.trend.length).toBeGreaterThan(0);
    await expect(new DashboardService(a.as.teacher).overview()).rejects.toBeInstanceOf(ForbiddenError);
  });
  it("reminders: run not started by the 25th, and each notice is written once", async () => {
    const day = `${monthEnd(addMonths(M0, 2)).slice(0, 8)}26`;
    const notes = await remindersFor(a.id, day);
    expect(notes.some((n) => n.title.startsWith("Pay run not started"))).toBe(true);
    expect(await remindersFor(a.id, `${day.slice(0, 8)}10`)).not.toContainEqual(expect.objectContaining({ title: expect.stringContaining("Pay run not started") }));
  });
});

describe("approval and reminders under load", () => {
  it("two approvals of the same run at once post it once", async () => {
    const runs = maker();
    const run = await runs.create({ month: month(2), kind: "off_cycle", userIds: [ids.p1], label: "Arrears pay" });
    const item = (await runs.get(run.id)).items[0]!;
    await runs.addAdjustment(item.id, { code: "arrears", amountPaise: 250_000 });
    await runs.review(run.id);
    const ap = await runs.submit(run.id);
    const before = await bal("salary_payable");
    const out = await Promise.allSettled([decider().approve({ id: ap.id }), decider().approve({ id: ap.id })]);
    expect(out.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const posted = await withSchool(a.id, async (tx) => (await tx.select().from(finJournalLines)).length);
    expect(posted).toBeGreaterThan(0);
    expect(await unbalanced()).toHaveLength(0);
    expect(await bal("salary_payable")).toBe(before - 250_000);
  });
  it("the daily reminder job writes each notice once however often it runs", async () => {
    await jobs["payroll.reminders"]();
    const count = () => withSchool(a.id, async (tx) => (await tx.select().from(notifications)).length);
    const first = await count();
    await jobs["payroll.reminders"]();
    expect(await count()).toBe(first);
  });
});

describe("a month with two rates, held deductions and cost centres", () => {
  it("pays each part at its own rate, books salary to the cost centre and holds employer costs where the school said", async () => {
    const c = (await createSchoolPair(["finance", "staff", "payroll", "notifications"], "split")).a;
    const ap = (who: Ctx = c.as.admin) => new ApprovalService(who, handlers);
    await new PayConfigService(c.as.admin).save({ pf: false, pt: false, tds: false });
    const [held, centre] = await withSchool(c.id, async (tx) => {
      await systemAccounts(tx, c.id);
      const [acc] = await tx.insert(finAccounts).values({ schoolId: c.id, code: "2900", name: "Canteen dues", type: "liability", group: "Payables" }).returning();
      const [cc] = await tx.insert(finCostCentres).values({ schoolId: c.id, name: "Science" }).returning();
      return [acc!.id, cc!.id] as const;
    });
    const sid = (await new StructureService(c.as.accountant).save({ name: "Plain", components: [
      { label: "Basic", kind: "earning", mode: "percent_of_gross", value: 10_000, isBasic: true, isWage: true },
      { label: "Canteen", kind: "deduction", mode: "fixed", value: 20_000, proRata: false, accountId: held },
      { label: "Welfare provision", kind: "employer", mode: "fixed", value: 10_000, proRata: false }] })).id;
    const [q1, q2] = [await mkStaff(c, "q1", "Raise Person"), await mkStaff(c, "q2", "Steady Person")];
    const m = month(1), D = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
    for (const [u, g] of [[q1, 3_000_000], [q2, 3_000_000]] as const) {
      await new AssignmentService(c.as.accountant).assign({ userId: u, structureId: sid, grossPaise: g, fromDate: addMonths(M0, -20) });
      await new ProfileService(c.as.accountant).save(u, { pan: "ABCDE1111F", bankAccount: "123456789012", ifsc: "DEMO0001234", ...(u === q1 ? { costCentreId: centre } : {}) });
    }
    await new AssignmentService(c.as.accountant).assign({ userId: q1, structureId: sid, grossPaise: 3_500_000, fromDate: `${m.slice(0, 7)}-15` });
    await expect(new StructureService(c.as.accountant).save({ name: "Bad", components: [{ label: "X", kind: "deduction", mode: "fixed", value: 1, accountId: "00000000-0000-4000-8000-000000000000" }] })).rejects.toBeInstanceOf(ValidationError);

    const runs = new RunService(c.as.accountant);
    const run = await runs.create({ month: m });
    const view = await runs.get(run.id);
    const raise = view.items.find((i) => i.name === "Raise Person")!;
    // 14 days at 30,000 and the rest at 35,000, each part paid for its own days.
    expect(raise.grossPaise).toBe(Math.round((3_000_000 * 28) / (2 * D)) + Math.round((3_500_000 * 2 * (D - 14)) / (2 * D)));
    const basic = (await runs.item(raise.id)).lines.find((l) => l.label === "Basic")!;
    expect(basic.source).toBeTruthy();
    const note = await withSchool(c.id, async (tx) => (await tx.select().from(payLines).where(eq(payLines.itemId, raise.id))).find((l) => l.label === "Basic")!.note);
    expect(note).toMatch(/^1 to 14 Oct: .+; 15 to 31 Oct: /);
    expect(view.items.find((i) => i.name === "Steady Person")!.grossPaise).toBe(3_000_000);

    await runs.review(run.id);
    await ap().approve({ id: (await runs.submit(run.id)).id });
    const bal2 = (key: "other_deductions" | "gratuity_payable" | "salaries") => withSchool(c.id, async (tx) => balanceOf(tx, [(await systemAccounts(tx, c.id))[key]]));
    expect(await bal2("gratuity_payable")).toBe(0);
    expect(await bal2("other_deductions")).toBe(-20_000);
    expect(await withSchool(c.id, (tx) => balanceOf(tx, [held]))).toBe(-40_000);
    // Salary for the person with a cost centre is booked to it.
    const booked = await withSchool(c.id, async (tx) => (await tx.select().from(finJournalLines).where(eq(finJournalLines.costCentreId, centre))).reduce((s, l) => s + l.debitPaise, 0));
    expect(booked).toBe(raise.grossPaise + 10_000); // salary plus the welfare provision, both to the cost centre
    expect(await withSchool(c.id, async (tx) => [...(await tx.execute(sql`select journal_id from fin_journal_lines group by journal_id having sum(debit_paise) <> sum(credit_paise)`))])).toHaveLength(0);
    const cost = await new ReportService(c.as.accountant).build("components", { by: "cost_centre", from: m, to: m });
    expect(cost.rows.map((r) => [r.label, r.gross])).toContainEqual(["Science", raise.grossPaise]);

    // Held amounts can be paid out, which clears them.
    const rem = new RemittanceService(c.as.accountant);
    const due = await rem.list({ onlyOpen: true });
    expect(due.map((r) => [r.label.startsWith("Canteen dues") ? "held" : r.key, r.outstandingPaise]).sort()).toEqual([["held", 40_000], ["other", 20_000]]);
    for (const r of due) await rem.record({ key: r.key, month: r.month, amountPaise: r.outstandingPaise });
    expect(await bal2("other_deductions")).toBe(0);
    expect(await withSchool(c.id, (tx) => balanceOf(tx, [held]))).toBe(0);
  });
  it("a rounding rule is a rate with a source and medium confidence, and can be overridden", async () => {
    const rows = (await new RateService(a.as.accountant).list()).filter((r) => r.key.startsWith("round_"));
    expect(rows.map((r) => r.key).sort()).toEqual(["round_eps", "round_esi_employee", "round_esi_employer", "round_pf_employee", "round_pf_employer"]);
    expect(rows.every((r) => r.confidence === "medium" && r.source.startsWith("https://"))).toBe(true);
    expect(rows.find((r) => r.key === "round_esi_employee")!.shown).toBe("up");
  });
});

describe("isolation", () => {
  it("school B sees nothing of school A's payroll", async () => {
    const runs = await maker().list({});
    expect(runs.rows.length).toBeGreaterThan(0);
    const other = new RunService(b.as.admin);
    expect((await other.list({})).rows).toHaveLength(0);
    await expect(other.get(runs.rows[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new PayoutService(b.as.admin).markPaid(runs.rows[0]!.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await new RemittanceService(b.as.admin).list())).toHaveLength(0);
    expect((await new ProfileService(b.as.admin).list({})).rows).toHaveLength(0);
    expect(await withSchool(b.id, async (tx) => (await tx.select().from(finApprovals)).length + (await tx.select().from(finJournalLines)).length)).toBe(0);
  });
});
