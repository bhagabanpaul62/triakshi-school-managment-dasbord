import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, auditLogs, closeDb, eq, withConsole, withSchool } from "@smw/db";
import { notifications } from "@smw/feature-notifications/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { addMonths, monthStart, todayIST } from "@smw/feature-kit/money";
import { createTestSchool, createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { systemAccounts } from "./chart";
import seed from "./seed";
import { cashAccount, postJournal, nextNumber } from "./posting";
import { finApprovals, finJournalLines, finJournals } from "./schema";
import {
  AccountService, ApprovalService, CashAccountService, ControlService, CostCentreService, FinanceDashboardService, JournalService, PeriodService, SeriesService, SettingsService, financeApprovals,
} from "./service";
import { ApprovalDeskService } from "./services/approval-desk";

let a: TestSchool, b: TestSchool, c: TestSchool, d: TestSchool;
const today = todayIST();
beforeAll(async () => {
  ({ a, b } = await createSchoolPair(["finance", "notifications"], "svc"));
  c = await createTestSchool("c-svc", ["finance", "notifications"]);
  d = await createTestSchool("d-svc", ["finance", "notifications"]);
  for (const s of [a, b, c, d]) await withSchool(s.id, (tx) => systemAccounts(tx, s.id));
});
afterAll(closeDb);

const chart = (s: TestSchool) => withSchool(s.id, (tx) => systemAccounts(tx, s.id));
const decide = (s: TestSchool, who = s.as.admin) => new ApprovalService(who, financeApprovals);
const manual = (accounts: Record<string, string>, over: Record<string, unknown> = {}) => ({
  date: today, memo: "Bought chairs", reason: "Office furniture",
  lines: [{ accountId: accounts.general_expense, debitPaise: 25_000 }, { accountId: accounts.cash, creditPaise: 25_000 }], ...over,
});

describe("accounts", () => {
  it("own accounts are free; system accounts are renamed, never deleted or retyped", async () => {
    const svc = new AccountService(a.as.accountant);
    const own = await svc.create({ code: "5400", name: "Sports kit", type: "expense", group: "Academic" });
    await expect(svc.create({ code: "5400", name: "Again", type: "expense", group: "Academic" })).rejects.toBeInstanceOf(ConflictError);
    await svc.update(own.id, { name: "Sports equipment" });
    const sys = (await svc.withBalances()).find((x) => x.systemKey === "cash")!;
    expect((await svc.update(sys.id, { name: "Cash box ledger" })).name).toBe("Cash box ledger");
    await expect(svc.update(sys.id, { type: "expense" })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.remove(sys.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.setActive(sys.id, false)).rejects.toBeInstanceOf(ConflictError);
    await svc.remove(own.id);
  });

  it("an account with entries cannot be deleted or retyped; its ledger runs a balance", async () => {
    const svc = new AccountService(a.as.accountant);
    const acc = await svc.create({ code: "5410", name: "Trophies", type: "expense", group: "Academic" });
    for (const [i, amt] of [[1, 700], [2, 300]] as const) await withSchool(a.id, (tx) => postJournal(tx, { schoolId: a.id, userId: a.users.admin }, {
      date: `2026-11-0${i}`, sourceKey: `ledger-${i}`, sourceType: "test", memo: `m${i}`, lines: [{ account: { id: acc.id }, debit: amt }, { account: "other_income", credit: amt }],
    }));
    await expect(svc.remove(acc.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.update(acc.id, { type: "income" })).rejects.toBeInstanceOf(ConflictError);
    const all = await svc.ledger(acc.id);
    expect(all.rows.rows.map((r) => r.runningPaise)).toEqual([700, 1000]);
    const later = await svc.ledger(acc.id, { from: "2026-11-02" });
    expect([later.openingPaise, later.closingPaise, later.rows.rows[0]!.runningPaise]).toEqual([700, 1000, 1000]);
  });

  it("cost centres: unique names, guarded delete", async () => {
    const svc = new CostCentreService(a.as.admin);
    const cc = await svc.create({ name: "Transport" });
    await expect(svc.create({ name: "Transport" })).rejects.toThrow();
    await expect(new CostCentreService(a.as.accountant).create({ name: "Hostel" })).rejects.toBeInstanceOf(ForbiddenError);
    await svc.remove(cc.id);
  });
});

describe("cash accounts", () => {
  it("opening posts once; transfer moves money; overdraw, same account and bad UPI are refused", async () => {
    const svc = new CashAccountService(a.as.accountant), admin = new CashAccountService(a.as.admin);
    const box = await withSchool(a.id, (tx) => cashAccount(tx, a.id, { kind: "cash" }));
    const bank = await admin.create({ name: "School bank", kind: "bank", upiId: "school@okbank", bankName: "Demo Bank", accountLast4: "4321", ifsc: "demo0001234" });
    expect(bank).toMatchObject({ isDefault: true, upiId: "school@okbank", ifsc: "DEMO0001234" });
    await expect(admin.create({ name: "Bad", kind: "bank", upiId: "not-a-upi" })).rejects.toBeInstanceOf(ValidationError);

    await expect(svc.setOpening({ accountId: box.id, amountPaise: 100_000, date: today })).rejects.toBeInstanceOf(ForbiddenError);
    await admin.setOpening({ accountId: box.id, amountPaise: 100_000, date: today });
    await expect(admin.setOpening({ accountId: box.id, amountPaise: 100_000, date: today })).rejects.toBeInstanceOf(ConflictError);
    await svc.transfer({ fromId: box.id, toId: bank.id, amountPaise: 40_000, date: today });
    await expect(svc.transfer({ fromId: box.id, toId: bank.id, amountPaise: 60_001, date: today })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.transfer({ fromId: box.id, toId: box.id, amountPaise: 1, date: today })).rejects.toBeInstanceOf(ValidationError);
    const balances = Object.fromEntries((await svc.list()).map((r) => [r.name, r.balancePaise]));
    expect(balances).toMatchObject({ "Cash box": 60_000, "School bank": 40_000 });
    const kinds = await withSchool(a.id, (tx) => tx.select({ k: finJournals.kind }).from(finJournals).where(eq(finJournals.sourceType, "transfer")));
    expect(kinds).toEqual([{ k: "transfer" }]);
    await expect(new CashAccountService(a.as.accountant).create({ name: "X", kind: "cash" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an account switches off only when empty and not the last of its kind; default moves with it", async () => {
    const admin = new CashAccountService(a.as.admin);
    const [box, bank] = [(await admin.list()).find((x) => x.kind === "cash")!, (await admin.list()).find((x) => x.kind === "bank")!];
    await expect(admin.setActive(bank.id, false)).rejects.toBeInstanceOf(ConflictError);
    const second = await admin.create({ name: "Savings", kind: "bank" });
    await expect(admin.setActive(bank.id, false)).rejects.toThrow(/holds money|zero/);
    await admin.transfer({ fromId: bank.id, toId: box.id, amountPaise: 40_000, date: today });
    await admin.setActive(bank.id, false);
    expect((await admin.list()).find((x) => x.id === second.id)!.isDefault).toBe(true);
  });
});

describe("manual journals and reversal", () => {
  it("a manual entry posts only after someone else approves; unbalanced and module-owned accounts are refused", async () => {
    const acc = await chart(a), journals = new JournalService(a.as.accountant);
    await expect(journals.propose(manual(acc, { lines: [{ accountId: acc.general_expense, debitPaise: 100 }, { accountId: acc.cash, creditPaise: 90 }] }))).rejects.toBeInstanceOf(ValidationError);
    await expect(journals.propose(manual(acc, { lines: [{ accountId: acc.student_dues, debitPaise: 100 }, { accountId: acc.cash, creditPaise: 100 }] }))).rejects.toBeInstanceOf(ConflictError);
    const before = await journals.list({ filters: { kind: "manual" } });
    const { approvalId } = await journals.propose(manual(acc));
    expect((await journals.list({ filters: { kind: "manual" } })).total).toBe(before.total);

    await expect(decide(a, a.as.accountant).approve({ id: approvalId })).rejects.toBeInstanceOf(ForbiddenError);
    const [ask] = await withSchool(a.id, (tx) => tx.select().from(finApprovals).where(eq(finApprovals.id, approvalId)));
    const drafts = await new JournalService(a.as.admin).drafts([ask!.refId]);
    expect(Object.values(drafts)[0]!.lines).toHaveLength(2);
    await decide(a).approve({ id: approvalId });
    const posted = await journals.list({ filters: { kind: "manual" } });
    expect(posted.total).toBe(before.total + 1);
    expect(posted.rows[0]).toMatchObject({ memo: "Bought chairs", totalPaise: 25_000 });
    expect((await journals.list({ filters: { account: acc.general_expense } })).rows.map((r) => r.memo)).toContain("Bought chairs");
    expect((await journals.list({ filters: { account: acc.fixed_assets } })).total).toBe(0);
  });

  it("the approvers' action row closes when the request is decided, and the asker is told", async () => {
    const acc = await chart(a), { approvalId } = await new JournalService(a.as.accountant).propose(manual(acc, { memo: "Row closes" }));
    const rows = () => withSchool(a.id, (tx) => tx.select().from(notifications).where(and(eq(notifications.subjectType, "approval"), eq(notifications.subjectId, approvalId))));
    const asked = (await rows()).filter((n) => n.topic === "work.approval");
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((n) => n.action && !n.doneAt)).toBe(true);
    await decide(a).approve({ id: approvalId });
    const after = await rows();
    expect(after.filter((n) => n.topic === "work.approval").every((n) => n.doneAt)).toBe(true);
    expect(after.some((n) => n.topic === "work.decision" && n.userId === a.users.accountant)).toBe(true);
  });

  it("the only admin cannot approve their own entry without a reason", async () => {
    const acc = await chart(b), { approvalId } = await new JournalService(b.as.admin).propose(manual(acc, { memo: "Own entry" }));
    await expect(decide(b).approve({ id: approvalId })).rejects.toBeInstanceOf(ConflictError);
    expect(await decide(b).approve({ id: approvalId, note: "I am the only admin" })).toMatchObject({ status: "approved", selfApproved: true });
  });

  it("an undo is a second entry linked both ways, once; module entries are not undone here", async () => {
    const svc = new JournalService(a.as.accountant), acc = await chart(a);
    const target = (await svc.list({ filters: { kind: "manual" } })).rows[0]!;
    const cashBefore = (await new CashAccountService(a.as.admin).list()).reduce((s, x) => s + x.balancePaise, 0);
    const { approvalId } = await svc.requestReversal(target.id, { reason: "Wrong account" });
    expect((await svc.get(target.id)).reversalPending).toBe(true);
    await expect(svc.requestReversal(target.id, { reason: "Again" })).rejects.toBeInstanceOf(ConflictError);
    await decide(a).approve({ id: approvalId });
    const view = await svc.get(target.id);
    expect(view.reversedBy).toBeTruthy();
    expect((await svc.get(view.reversedBy!.id)).reverses?.id).toBe(target.id);
    expect(view.canReverse).toBe(false);
    await expect(svc.requestReversal(target.id, { reason: "Third" })).rejects.toBeInstanceOf(ConflictError);
    expect((await new CashAccountService(a.as.admin).list()).reduce((s, x) => s + x.balancePaise, 0)).toBe(cashBefore + 25_000);
    const auto = await withSchool(a.id, async (tx) => (await postJournal(tx, { schoolId: a.id, userId: a.users.admin }, { date: today, sourceKey: "auto-1", sourceType: "fees:receipt", memo: "x", lines: [{ account: "cash", debit: 5 }, { account: { id: acc.other_income }, credit: 5 }] }))!.id);
    await expect(svc.requestReversal(auto, { reason: "Nope" })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("number series", () => {
  it("shows every series with a preview, edits until first use, then locks", async () => {
    const svc = new SeriesService(a.as.admin);
    const rows = await svc.list();
    expect(rows.map((r) => r.key)).toEqual(["receipt", "invoice", "credit_note", "voucher", "other_receipt", "payslip", "journal"]);
    const edited = await svc.edit("receipt", { prefix: "gvs", width: 5, startAt: 10 });
    expect(edited).toMatchObject({ prefix: "GVS", locked: false });
    expect(edited.next).toMatch(/^GVS\/\d{4}-\d{2}\/00010$/);
    expect(await withSchool(a.id, (tx) => nextNumber(tx, a.id, "receipt", today))).toMatch(/^GVS\/.*\/00010$/);
    expect((await svc.list()).find((r) => r.key === "receipt")).toMatchObject({ locked: true });
    await expect(svc.edit("receipt", { prefix: "X", width: 6, startAt: 1 })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.edit("journal", { prefix: "JV2", width: 6, startAt: 1 })).rejects.toBeInstanceOf(ConflictError);
    await expect(new SeriesService(a.as.accountant).edit("voucher", { prefix: "PV", width: 6, startAt: 1 })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("periods", () => {
  const prev = addMonths(monthStart(today), -1);
  it("a closed month sends a late entry on; reopening needs a reason and is audited", async () => {
    const svc = new PeriodService(a.as.admin);
    await svc.softClose(prev);
    await expect(svc.softClose(prev)).rejects.toBeInstanceOf(ConflictError);
    await svc.close(prev);
    const j = await withSchool(a.id, (tx) => postJournal(tx, { schoolId: a.id, userId: a.users.admin }, { date: prev, sourceKey: "late-1", sourceType: "test", memo: "late", lines: [{ account: "cash", debit: 9 }, { account: "other_income", credit: 9 }] }));
    const [row] = await withSchool(a.id, (tx) => tx.select().from(finJournals).where(eq(finJournals.id, j!.id)));
    expect(row).toMatchObject({ date: monthStart(today), originalDate: prev });
    expect((await svc.list()).find((p) => p.month === prev)).toMatchObject({ status: "closed" });
    await expect(svc.reopen(prev, {})).rejects.toBeInstanceOf(ValidationError);
    await svc.reopen(prev, { reason: "Auditor asked for a correction" });
    expect((await svc.list()).find((p) => p.month === prev)).toMatchObject({ status: "open" });
    const log = await withSchool(a.id, (tx) => tx.select().from(auditLogs).where(eq(auditLogs.action, "reopen")));
    expect(log[0]!.summary).toContain("Auditor asked");
    await expect(new PeriodService(a.as.accountant).close(prev)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.close(addMonths(monthStart(today), 2))).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("finance settings", () => {
  it("rules are saved from a form; the basis is fixed once this year has entries", async () => {
    const svc = new SettingsService(d.as.admin);
    const saved = await svc.update({ basis: "cash", backdateDays: "3", lateFeeFirst: "true", remindersOn: "true", reminderDays: "-3, 0, 7", concessionLimitPaise: "50000", cashLimitPaise: "1000000" });
    expect(saved).toMatchObject({ basis: "cash", backdateDays: 3, lateFeeFirst: true, remindersOn: true, upiOn: false, reminderDays: [-3, 0, 7], concessionLimitPaise: 50_000 });
    expect((await svc.update({ basis: "accrual" })).basis).toBe("accrual");
    await svc.update({ basis: "cash" });
    await withSchool(d.id, (tx) => postJournal(tx, { schoolId: d.id, userId: d.users.admin }, { date: today, sourceKey: "d-1", sourceType: "test", memo: "x", lines: [{ account: "cash", debit: 5 }, { account: "other_income", credit: 5 }] }));
    expect(await svc.get()).toMatchObject({ basis: "cash", basisLocked: true });
    await expect(svc.update({ basis: "accrual" })).rejects.toBeInstanceOf(ConflictError);
    expect((await svc.update({ basis: "cash", backdateDays: "5" })).backdateDays).toBe(5);
    await expect(new SettingsService(d.as.accountant).update({ basis: "cash" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("control checks and dashboard", () => {
  it("catches a tampered line and reports it by name", async () => {
    const ctl = new ControlService(a.as.admin);
    expect(await ctl.checks()).toEqual([]);
    const [line] = await withSchool(a.id, (tx) => tx.select().from(finJournalLines).where(eq(finJournalLines.debitPaise, 25_000)).limit(1));
    await withConsole((tx) => tx.update(finJournalLines).set({ debitPaise: 25_007 }).where(eq(finJournalLines.id, line!.id)));
    const found = await ctl.checks([{ name: "Extra", run: async () => ["custom problem"] }]);
    expect(found.map((m) => m.check)).toContain("Ledger");
    expect(found.some((m) => m.problem.includes("does not balance"))).toBe(true);
    expect(found).toContainEqual({ check: "Extra", problem: "custom problem" });
    await withConsole((tx) => tx.update(finJournalLines).set({ debitPaise: 25_000 }).where(eq(finJournalLines.id, line!.id)));
    expect(await ctl.checks()).toEqual([]);
  });

  it("a check that crashes is reported and does not hide the rest", async () => {
    const found = await new ControlService(a.as.admin).checks([{ name: "Broken", run: async () => { throw new Error("boom"); } }]);
    expect(found).toEqual([{ check: "Broken", problem: "This check could not run." }]);
  });

  it("the dashboard adds up cash, month flow, waiting requests and what is owed", async () => {
    const acc = await chart(c), poster = { schoolId: c.id, userId: c.users.admin };
    const box = await withSchool(c.id, (tx) => cashAccount(tx, c.id, { kind: "cash" }));
    await new CashAccountService(c.as.admin).setOpening({ accountId: box.id, amountPaise: 500_000, date: today });
    const kid = "0190a000-0000-7000-8000-0000000000aa";
    await withSchool(c.id, async (tx) => {
      await postJournal(tx, poster, { date: today, sourceKey: "in-1", sourceType: "test", memo: "in", lines: [{ account: "cash", debit: 30_000 }, { account: "other_income", credit: 30_000 }] });
      await postJournal(tx, poster, { date: today, sourceKey: "out-1", sourceType: "test", memo: "out", lines: [{ account: "general_expense", debit: 10_000 }, { account: "cash", credit: 10_000 }] });
      await postJournal(tx, poster, { date: today, sourceKey: "due-1", sourceType: "test", memo: "due", lines: [{ account: "student_dues", debit: 70_000, party: { type: "student", id: kid } }, { account: "fee_income", credit: 70_000 }] });
    });
    await new JournalService(c.as.accountant).propose(manual(acc));
    const o = await new FinanceDashboardService(c.as.admin).overview();
    expect(o).toMatchObject({ cashTotalPaise: 520_000, monthInPaise: 30_000, monthOutPaise: 10_000, pendingApprovals: 1, mismatches: [] });
    expect(o.owed.studentDuesPaise).toBe(70_000);
    expect(o.trend).toHaveLength(12);
    expect(o.recent.length).toBeGreaterThan(0);
    expect(o.cash.map((x) => x.name)).toEqual(["Cash box"]);
  });
});

describe("permissions and isolation", () => {
  it("teachers and students are refused everywhere; accountants cannot approve, close or change settings", async () => {
    for (const who of [a.as.teacher, a.as.student]) {
      await expect(new AccountService(who).withBalances()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new CashAccountService(who).list()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new JournalService(who).list()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new SeriesService(who).list()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new PeriodService(who).list()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new SettingsService(who).get()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new ControlService(who).checks()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new FinanceDashboardService(who).overview()).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new JournalService(who).propose(manual({}))).rejects.toBeInstanceOf(ForbiddenError);
    }
    const acct = a.as.accountant;
    await expect(new PeriodService(acct).softClose(addMonths(monthStart(today), -1))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SettingsService(acct).update({ basis: "cash" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new JournalService(acct).drafts([])).rejects.toBeInstanceOf(ForbiddenError);
    expect(await new AccountService(acct).withBalances()).not.toHaveLength(0);
  });

  it("school B cannot see or move anything of school A", async () => {
    const aJournal = (await new JournalService(a.as.admin).list()).rows[0]!, aAccount = (await new AccountService(a.as.admin).withBalances())[0]!;
    await expect(new JournalService(b.as.admin).get(aJournal.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new AccountService(b.as.admin).ledger(aAccount.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new JournalService(b.as.admin).requestReversal(aJournal.id, { reason: "steal" })).rejects.toBeInstanceOf(NotFoundError);
    const aBank = (await new CashAccountService(a.as.admin).list())[0]!;
    const bBox = await withSchool(b.id, (tx) => cashAccount(tx, b.id, { kind: "cash" }));
    await expect(new CashAccountService(b.as.admin).transfer({ fromId: bBox.id, toId: aBank.id, amountPaise: 1, date: today })).rejects.toBeInstanceOf(ConflictError);
    expect([(await new JournalService(b.as.admin).list({ q: "Own entry" })).total, (await new JournalService(b.as.admin).list({ q: "Bought chairs" })).total]).toEqual([1, 0]);
  });
});

describe("seed", () => {
  it("gives a cash box, a bank account with a UPI ID, balances and two cost centres, once", async () => {
    const e = await createTestSchool("e-svc", ["finance", "notifications"]);
    await seed(e.as.admin, {});
    await seed(e.as.admin, {});
    const cash = await new CashAccountService(e.as.admin).list();
    expect(cash.map((x) => [x.kind, x.balancePaise])).toEqual([["bank", 400_000_000], ["cash",  20_000_000]]);
    expect(cash.find((x) => x.kind === "bank")!.upiId).toBe("demoschool@okdemo");
    expect((await new CostCentreService(e.as.admin).list()).total).toBe(2);
  });
});

describe("who may approve", () => {
  it("whoever the document pays or who made it is treated like the requester; withdrawing frees the document", async () => {
    const accounts = await chart(d), kind = "finance.journal";
    const freed: string[] = [];
    const handlers = { [kind]: { ...financeApprovals[kind]!, involved: async () => [d.users.admin], withdraw: async (_tx: unknown, x: { refId: string }) => { freed.push(x.refId); } } };
    const one = await new JournalService(d.as.accountant).propose(manual(accounts));
    await expect(new ApprovalService(d.as.admin, handlers).approve({ id: one.approvalId })).rejects.toThrow(/only admin/);
    expect(await new ApprovalService(d.as.admin, handlers).approve({ id: one.approvalId, note: "Only admin" })).toMatchObject({ selfApproved: true });
    const two = await new JournalService(d.as.accountant).propose(manual(accounts));
    await new ApprovalDeskService(d.as.accountant, handlers).withdraw(two.approvalId);
    expect(freed).toEqual([two.draftId]);
  });
});
