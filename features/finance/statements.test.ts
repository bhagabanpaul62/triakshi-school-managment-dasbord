import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, eq, migrateDb, schoolRoles, sql, users, withConsole, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, ValidationError } from "@smw/feature-kit";
import { fyOf, todayIST } from "@smw/feature-kit/money";
import { createTestSchool, createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { systemAccounts } from "./chart";
import { cashAccount, postJournal } from "./posting";
import { finJournalLines, finJournals } from "./schema";
import {
  AccountService, ApprovalDeskService, ApprovalService, CashAccountService, FinanceDashboardService, JournalService, PeriodService, StatementService, TallyExportService, YearCloseService,
  comparePeriod, csvText, financeApprovals, reportToCsv, reportToPdf, type Report, type StatementKind,
} from "./service";
import type { SystemAccount } from "./chart";
import plainJobs, { financeJobs } from "./jobs";

// The scripted month is dated in November 2026, so the clock stands there and "this financial year" means 2026-27 whenever the suite runs.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-11-24T10:00:00+05:30"));

let s: TestSchool, other: TestSchool, inj: TestSchool, yc: TestSchool, rnd: TestSchool, dash: TestSchool;
const R = (rupees: number) => rupees * 100;
let n = 0;

async function post(school: TestSchool, date: string, lines: { account: SystemAccount; debit?: number; credit?: number }[], over: { memo?: string; sourceType?: string; kind?: "auto" | "transfer" } = {}) {
  return withSchool(school.id, (tx) => postJournal(tx, { schoolId: school.id, userId: school.users.admin }, { date, sourceKey: `st-${++n}`, sourceType: over.sourceType ?? "test", kind: over.kind, memo: over.memo ?? `Entry ${n}`, lines }));
}
const run = (who: TestSchool["as"]["admin"], kind: StatementKind, from: string, to: string, extra: Record<string, unknown> = {}) => new StatementService(who).run({ kind, from, to, ...extra });
const find = (r: Report, text: string, key = "account") => r.rows.find((x) => String(x.cells[key] ?? "").includes(text));
const at = (r: Report, text: string, col: string, key = "account") => find(r, text, key)?.cells[col];

beforeAll(async () => {
  ({ a: s, b: other } = await createSchoolPair(["finance", "notifications"], "stm"));
  const more = await Promise.all(["inj", "yc", "rnd", "dash"].map((x) => createTestSchool(`${x}-stm`, ["finance", "notifications"])));
  [inj, yc, rnd, dash] = more as [TestSchool, TestSchool, TestSchool, TestSchool];
  for (const x of [s, other, inj, yc, rnd, dash]) await withSchool(x.id, async (tx) => { await systemAccounts(tx, x.id); await cashAccount(tx, x.id, { kind: "cash" }); await cashAccount(tx, x.id, { kind: "bank" }); });

  // The scripted month. Every figure in the tests below is worked out by hand from these lines.
  const bank = (await new CashAccountService(s.as.admin).list()).find((c) => c.kind === "bank")!;
  await new CashAccountService(s.as.admin).setOpening({ accountId: bank.id, amountPaise: R(1_000_000), date: "2026-10-31" });
  await post(s, "2026-10-15", [{ account: "bank", debit: R(1_500) }, { account: "other_income", credit: R(1_500) }]);
  await post(s, "2026-11-02", [{ account: "student_dues", debit: R(100_000) }, { account: "fee_income", credit: R(100_000) }]);
  await post(s, "2026-11-05", [{ account: "bank", debit: R(60_000) }, { account: "student_dues", credit: R(60_000) }]);
  await post(s, "2026-11-06", [{ account: "cash", debit: R(10_000) }, { account: "student_dues", credit: R(10_000) }]);
  await post(s, "2026-11-10", [{ account: "salaries", debit: R(40_000) }, { account: "bank", credit: R(40_000) }]);
  await post(s, "2026-11-12", [{ account: "general_expense", debit: R(5_000) }, { account: "cash", credit: R(5_000) }]);
  await post(s, "2026-11-15", [{ account: "concessions", debit: R(4_000) }, { account: "student_dues", credit: R(4_000) }]);
  await post(s, "2026-11-20", [{ account: "bank", debit: R(3_000) }, { account: "cash", credit: R(3_000) }], { sourceType: "transfer", kind: "transfer" });
  await post(s, "2026-11-22", [{ account: "bank", debit: R(2_000) }, { account: "other_income", credit: R(2_000) }]);
});
afterAll(closeDb);

describe("statements on a scripted month", () => {
  it("trial balance: opening, movement and closing of every account, and it balances", async () => {
    const tb = await run(s.as.accountant, "trial-balance", "2026-11-01", "2026-11-30");
    expect(tb.balanced).toBe(true);
    const total = tb.report.rows.at(-1)!.cells;
    expect(total).toMatchObject({ debit: R(224_000), credit: R(224_000), closeDr: R(1_103_500), closeCr: R(1_103_500), openDr: R(1_001_500), openCr: R(1_001_500) });
    expect(find(tb.report, "Bank")!.cells).toMatchObject({ openDr: R(1_001_500), debit: R(65_000), credit: R(40_000), closeDr: R(1_026_500) });
    expect(find(tb.report, "Fee income")!.cells).toMatchObject({ credit: R(100_000), closeCr: R(100_000), openDr: null });
    expect(find(tb.report, "Student dues")!.cells.closeDr).toBe(R(26_000));
    expect(find(tb.report, "Student dues")!.links!.account).toBe(`/app/finance/accounts/${await accountId(s, "student_dues")}?from=2026-11-01&to=2026-11-30`);
  });

  it("income and expenditure, with last month beside it", async () => {
    const r = await run(s.as.accountant, "income-expenditure", "2026-11-01", "2026-11-30");
    expect(at(r.report, "Fee income", "cur")).toBe(R(100_000));
    expect(at(r.report, "Fee concessions", "cur")).toBe(-R(4_000));
    expect(at(r.report, "Total income", "cur")).toBe(R(98_000));
    expect(at(r.report, "Total expenditure", "cur")).toBe(R(45_000));
    expect(at(r.report, "Surplus", "cur")).toBe(R(53_000));
    const cmp = await run(s.as.accountant, "income-expenditure", "2026-11-01", "2026-11-30", { compare: "previous" });
    expect(cmp.comparing).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(find(cmp.report, "Surplus")!.cells).toMatchObject({ cur: R(53_000), prev: R(1_500), change: R(51_500) });
    expect(at(cmp.report, "Other income", "prev")).toBe(R(1_500));
  });

  it("receipts and payments: cash and bank money in and out, own transfers left out, closing equals the books", async () => {
    const r = await run(s.as.accountant, "receipts-payments", "2026-11-01", "2026-11-30");
    expect(at(r.report, "Opening cash and bank", "cur")).toBe(R(1_001_500));
    expect(at(r.report, "Student dues", "cur")).toBe(R(70_000));
    expect(at(r.report, "Other income", "cur")).toBe(R(2_000));
    expect(at(r.report, "Total receipts", "cur")).toBe(R(72_000));
    expect(at(r.report, "Salaries", "cur")).toBe(R(40_000));
    expect(at(r.report, "Total payments", "cur")).toBe(R(45_000));
    expect(at(r.report, "Closing cash and bank", "cur")).toBe(R(1_028_500));
    expect(r.balanced).toBe(true);
    const yearAgo = await run(s.as.accountant, "receipts-payments", "2026-11-01", "2026-11-30", { compare: "year" });
    expect(yearAgo.comparing).toEqual({ from: "2025-11-01", to: "2025-11-30" });
  });

  it("balance sheet: assets equal liabilities and funds, with the year's surplus in funds", async () => {
    const r = await run(s.as.accountant, "balance-sheet", "2026-11-01", "2026-11-30");
    expect(r.balanced).toBe(true);
    expect(at(r.report, "Total assets", "cur")).toBe(R(1_054_500));
    expect(at(r.report, "Total funds", "cur")).toBe(R(1_054_500));
    expect(at(r.report, "Surplus of the year", "cur")).toBe(R(54_500));
    expect(at(r.report, "Opening balances", "cur")).toBe(R(1_000_000));
    expect(at(r.report, "Total liabilities and funds", "cur")).toBe(R(1_054_500));
    const before = await run(s.as.accountant, "balance-sheet", "2026-11-01", "2026-11-30", { compare: "previous" });
    expect(before.comparing!.to).toBe("2026-10-31");
    expect(find(before.report, "Total assets")!.cells).toMatchObject({ cur: R(1_054_500), prev: R(1_001_500) });
    expect(before.balanced).toBe(true);
  });

  it("day book, cash book, bank book and an account ledger add up to the same figures", async () => {
    const day = await run(s.as.accountant, "day-book", "2026-11-01", "2026-11-30");
    expect(day.report.rows).toHaveLength(8 * 2 + 1);
    expect(day.report.rows.at(-1)!.cells).toMatchObject({ debit: R(224_000), credit: R(224_000) });
    expect(day.balanced).toBe(true);
    expect(day.report.rows[0]!.links!.number).toMatch(/^\/app\/finance\/journals\//);

    const cash = await run(s.as.accountant, "cash-book", "2026-11-01", "2026-11-30");
    expect(cash.report.rows[0]!.cells.balance).toBe(0);
    expect(cash.report.rows.at(-1)!.cells).toMatchObject({ debit: R(10_000), credit: R(8_000), balance: R(2_000) });
    const bank = await run(s.as.accountant, "bank-book", "2026-11-01", "2026-11-30");
    expect(bank.report.rows[0]!.cells.balance).toBe(R(1_001_500));
    expect(bank.report.rows.at(-1)!.cells).toMatchObject({ debit: R(65_000), credit: R(40_000), balance: R(1_026_500) });
    expect(bank.report.rows.filter((x) => !x.style).map((x) => x.cells.balance)).toEqual([R(1_061_500), R(1_021_500), R(1_024_500), R(1_026_500)]);

    const ledger = await run(s.as.accountant, "ledger", "2026-11-01", "2026-11-30", { accountId: await accountId(s, "student_dues") });
    expect(ledger.report.rows.at(-1)!.cells).toMatchObject({ debit: R(100_000), credit: R(74_000), balance: R(26_000) });
    await expect(run(s.as.accountant, "ledger", "2026-11-01", "2026-11-30")).rejects.toBeInstanceOf(ValidationError);
    await expect(run(s.as.accountant, "ledger", "2026-11-01", "2026-11-30", { accountId: await accountId(other, "student_dues") })).rejects.toBeInstanceOf(ValidationError);
  });

  it("a long day book pages, and the export takes every line", async () => {
    const svc = new StatementService(s.as.accountant);
    const page = await svc.run({ kind: "day-book", from: "2026-01-01", to: "2026-12-31", page: 1 });
    expect(page.page).toMatchObject({ page: 1, total: 20 });
    const csv = await svc.csv({ kind: "day-book", from: "2026-11-01", to: "2026-11-30" });
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(3 + 17);
  });

  it("the dates must make sense", async () => {
    await expect(run(s.as.accountant, "trial-balance", "2026-11-30", "2026-11-01")).rejects.toBeInstanceOf(ValidationError);
    await expect(run(s.as.accountant, "trial-balance", "nope", "2026-11-01")).rejects.toBeInstanceOf(ValidationError);
  });

  it("an entry changed outside the product shows a banner and never a silent wrong total", async () => {
    const [line] = await withSchool(s.id, (tx) => tx.select().from(finJournalLines).where(eq(finJournalLines.debitPaise, R(2_000))).limit(1));
    await withConsole((tx) => tx.update(finJournalLines).set({ debitPaise: R(2_000) + 7 }).where(eq(finJournalLines.id, line!.id)));
    const bs = await run(s.as.accountant, "balance-sheet", "2026-11-01", "2026-11-30"), tb = await run(s.as.accountant, "trial-balance", "2026-11-01", "2026-11-30");
    await withConsole((tx) => tx.update(finJournalLines).set({ debitPaise: R(2_000) }).where(eq(finJournalLines.id, line!.id)));
    expect([bs.balanced, tb.balanced]).toEqual([false, false]);
    expect(bs.report.warning).toMatch(/does not balance/);
    expect(tb.report.warning).toMatch(/does not balance/);
    expect((await run(s.as.accountant, "balance-sheet", "2026-11-01", "2026-11-30")).balanced).toBe(true);
  });
});

describe("comparing periods", () => {
  it("steps back by whole months, by days, or a year", () => {
    expect(comparePeriod({ from: "2026-11-01", to: "2026-11-30" }, "previous")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(comparePeriod({ from: "2026-04-01", to: "2027-03-31" }, "previous")).toEqual({ from: "2025-04-01", to: "2026-03-31" });
    expect(comparePeriod({ from: "2026-10-01", to: "2026-12-31" }, "previous")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(comparePeriod({ from: "2026-11-10", to: "2026-11-19" }, "previous")).toEqual({ from: "2026-10-31", to: "2026-11-09" });
    expect(comparePeriod({ from: "2024-02-29", to: "2024-03-10" }, "year")).toEqual({ from: "2023-02-28", to: "2023-03-10" });
  });
});

describe("export", () => {
  it("CSV cells cannot run as formulas in Excel", async () => {
    expect(["=1+1", "+1", "-1", "@SUM(A1)", "\t=x", "plain", 'say "hi"', "a,b"].map(csvText)).toEqual(["'=1+1", "'+1", "'-1", "'@SUM(A1)", "'\t=x", "plain", '"say ""hi"""', '"a,b"']);
    for (const memo of ["=HYPERLINK(\"http://evil\",\"x\")", "+cmd|' /C calc'!A0", "@SUM(1)", "-2+3"]) await post(inj, "2026-11-03", [{ account: "cash", debit: 100 }, { account: "other_income", credit: 100 }], { memo });
    const csv = await new StatementService(inj.as.admin).csv({ kind: "day-book", from: "2026-11-01", to: "2026-11-30" });
    for (const line of csv.split("\r\n").slice(4).filter(Boolean)) expect(line).not.toMatch(/(^|,)"?[=+@]/);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'-2+3");
    expect(csv.startsWith("﻿")).toBe(true);
  });

  it("money is written in rupees and the statement title and period lead the file; the PDF is a real PDF", async () => {
    const svc = new StatementService(s.as.accountant);
    const csv = await svc.csv({ kind: "income-expenditure", from: "2026-11-01", to: "2026-11-30" });
    expect(csv).toContain("Income and expenditure");
    expect(csv).toContain("Fee income,100000.00");
    expect(csv).toContain("Surplus (income less expenditure),53000.00");
    const pdf = await svc.pdf({ kind: "trial-balance", from: "2026-11-01", to: "2026-11-30" });
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    const wide = await reportToPdf({ title: "T", subtitle: "S", columns: [{ key: "a", label: "A" }, { key: "m", label: "M", kind: "money" }], rows: [{ cells: { a: "x".repeat(300), m: 5 } }] }, "School");
    expect(wide.byteLength).toBeGreaterThan(500);
    expect(reportToCsv({ title: "T", subtitle: "S", columns: [{ key: "m", label: "M", kind: "money" }], rows: [{ cells: { m: -250 } }] })).toContain("\r\n-2.50\r\n");
  });
});

describe("the balance sheet after random entries", () => {
  it("always balances, and so does the trial balance", async () => {
    let seed = 7;
    const rand = (k: number) => { seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff; return seed % k; };
    const keys: SystemAccount[] = ["cash", "bank", "student_dues", "fee_income", "concessions", "other_income", "salaries", "general_expense", "vendor_dues", "student_advances", "pf_payable", "fixed_assets", "bad_debts"];
    for (let i = 0; i < 150; i++) {
      const total = (rand(9_000) + 1) * 100, parts = rand(3) + 1, debits: number[] = [], credits: number[] = [];
      for (let p = 0; p < parts; p++) { debits.push(Math.floor(total / parts)); credits.push(Math.floor(total / parts)); }
      debits[0]! += total - debits.reduce((x, y) => x + y, 0); credits[0]! += total - credits.reduce((x, y) => x + y, 0);
      await post(rnd, `2026-${String(rand(11) + 1).padStart(2, "0")}-${String(rand(27) + 1).padStart(2, "0")}`, [...debits.map((d) => ({ account: keys[rand(keys.length)]!, debit: d })), ...credits.map((c) => ({ account: keys[rand(keys.length)]!, credit: c }))]);
    }
    for (const to of ["2026-03-31", "2026-08-15", "2026-12-31"]) {
      const bs = await run(rnd.as.admin, "balance-sheet", "2026-01-01", to), tb = await run(rnd.as.admin, "trial-balance", "2026-01-01", to);
      expect([bs.balanced, tb.balanced]).toEqual([true, true]);
      expect(at(bs.report, "Total assets", "cur")).toBe(at(bs.report, "Total liabilities and funds", "cur"));
    }
    expect((await run(rnd.as.admin, "receipts-payments", "2026-01-01", "2026-12-31")).balanced).toBe(true);
  });
});

describe("year close", () => {
  const FY = "2025-26";
  it("is blocked by what is waiting, then carries income and expense to the surplus, locks the year and cannot run twice", async () => {
    await post(yc, "2025-06-10", [{ account: "bank", debit: R(100_000) }, { account: "fee_income", credit: R(100_000) }]);
    await post(yc, "2025-08-05", [{ account: "salaries", debit: R(30_000) }, { account: "bank", credit: R(30_000) }]);
    await post(yc, "2026-02-10", [{ account: "general_expense", debit: R(10_000) }, { account: "bank", credit: R(10_000) }]);
    const chart = await withSchool(yc.id, (tx) => systemAccounts(tx, yc.id));
    const { approvalId } = await new JournalService(yc.as.accountant).propose({ date: todayIST(), memo: "Chairs", reason: "Office", lines: [{ accountId: chart.general_expense, debitPaise: 500 }, { accountId: chart.other_income, creditPaise: 500 }] });
    const svc = new YearCloseService(yc.as.admin);

    const before = await svc.preview(FY);
    expect(before.ready).toBe(false);
    expect(before.checks.find((c) => c.key === "approvals")).toMatchObject({ ok: false, blocking: true, href: "/app/finance/approvals" });
    expect(before).toMatchObject({ incomeTotalPaise: R(100_000), expenseTotalPaise: R(40_000), surplusPaise: R(60_000) });
    expect(before.lines.reduce((x, l) => x + l.debitPaise - l.creditPaise, 0)).toBe(0);
    await expect(svc.run(FY)).rejects.toThrow(/waiting for a decision/);
    await new ApprovalService(yc.as.admin, financeApprovals).approve({ id: approvalId });

    expect((await svc.preview(FY)).ready).toBe(true);
    expect((await svc.preview("2026-27")).checks.find((c) => c.key === "ended")).toMatchObject({ ok: false });
    await expect(svc.run("2026-27")).rejects.toThrow(/cannot close before then/);
    await expect(new YearCloseService(yc.as.accountant).run(FY)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new YearCloseService(yc.as.accountant).preview(FY)).rejects.toBeInstanceOf(ForbiddenError);

    const done = await svc.run(FY);
    expect(done).toMatchObject({ fy: FY, run: 1, surplusPaise: R(60_000) });
    const [j] = await withSchool(yc.id, (tx) => tx.select().from(finJournals).where(eq(finJournals.id, done.journalId!)));
    expect(j).toMatchObject({ date: "2026-03-31", kind: "auto", sourceKey: `finance:year:${FY}`, sourceType: "year-close" });
    await expect(svc.run(FY)).rejects.toThrow(/already closed/);

    const balances = Object.fromEntries((await new AccountService(yc.as.admin).withBalances()).map((x) => [x.name, x.balancePaise]));
    expect(balances).toMatchObject({ "Fee income": 0, Salaries: 0, "General expenses": 500, "Accumulated surplus": -R(60_000), Bank: R(60_000) });
    expect((await new PeriodService(yc.as.admin).list(FY)).every((p) => p.status === "closed")).toBe(true);
  });

  it("the closed year still reads as it was, and next year opens with exactly what it closed with", async () => {
    const ie = await run(yc.as.admin, "income-expenditure", "2025-04-01", "2026-03-31");
    expect(find(ie.report, "Surplus")!.cells.cur).toBe(R(60_000));
    const sheet = await run(yc.as.admin, "balance-sheet", "2025-04-01", "2026-03-31");
    expect(sheet.balanced).toBe(true);
    expect(at(sheet.report, "Total assets", "cur")).toBe(R(60_000));
    expect(at(sheet.report, "Accumulated surplus", "cur")).toBe(R(60_000));
    expect(at(sheet.report, "Surplus of the year", "cur")).toBeUndefined();

    const next = await run(yc.as.admin, "trial-balance", "2026-04-01", "2026-04-30");
    expect(find(next.report, "Bank")!.cells).toMatchObject({ openDr: R(60_000), closeDr: R(60_000) });
    expect(find(next.report, "Accumulated surplus")!.cells).toMatchObject({ openCr: R(60_000) });
    for (const name of ["Fee income", "Salaries", "General expenses"]) expect(find(next.report, name)).toBeUndefined();
    const pre = await run(yc.as.admin, "trial-balance", "2025-04-01", "2026-03-31");
    expect(pre.report.notes?.[0]).toMatch(/closing entry/);
    expect(find(pre.report, "Fee income")!.cells.closeCr).toBe(R(100_000));
  });

  it("a late entry for the closed year lands in the next open month and keeps its own date", async () => {
    const j = await post(yc, "2026-02-20", [{ account: "bank", debit: 1 }, { account: "other_income", credit: 1 }]);
    const [row] = await withSchool(yc.id, (tx) => tx.select().from(finJournals).where(eq(finJournals.id, j!.id)));
    expect(row).toMatchObject({ date: "2026-04-01", originalDate: "2026-02-20" });
  });

  it("reopening needs a reason and a decision, undoes the closing entry and opens the months; closing again is a second run", async () => {
    const svc = new YearCloseService(yc.as.admin), FY2 = "2025-26";
    await expect(svc.requestReopen(FY2, {})).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.requestReopen("2024-25", { reason: "Never closed" })).rejects.toBeInstanceOf(ConflictError);
    const { approvalId } = await svc.requestReopen(FY2, { reason: "Auditor found a missing bill" });
    expect((await svc.preview(FY2)).reopenPending).toBe(true);
    await expect(svc.requestReopen(FY2, { reason: "Again" })).rejects.toBeInstanceOf(ConflictError);
    expect((await new ApprovalDeskService(yc.as.admin).approvers(yc.users.admin))).toEqual([]);
    await expect(new ApprovalService(yc.as.admin, financeApprovals).approve({ id: approvalId })).rejects.toBeInstanceOf(ConflictError);
    await new ApprovalService(yc.as.admin, financeApprovals).approve({ id: approvalId, note: "Only admin" });

    const balances = Object.fromEntries((await new AccountService(yc.as.admin).withBalances()).map((x) => [x.name, x.balancePaise]));
    expect(balances).toMatchObject({ "Fee income": -R(100_000), "Accumulated surplus": 0 });
    expect((await new PeriodService(yc.as.admin).list(FY2)).every((p) => p.status === "open")).toBe(true);
    expect((await svc.history())[0]).toMatchObject({ fy: FY2, run: 1, status: "reopened", reopenReason: "Auditor found a missing bill" });
    await expect(svc.requestReopen(FY2, { reason: "Still open" })).rejects.toBeInstanceOf(ConflictError);

    const again = await svc.run(FY2);
    expect(again.run).toBe(2);
    const [j] = await withSchool(yc.id, (tx) => tx.select().from(finJournals).where(eq(finJournals.id, again.journalId!)));
    expect(j!.sourceKey).toBe(`finance:year:${FY2}:2`);
  });
});

describe("Tally export", () => {
  const body = (xml: string) => [...xml.matchAll(/<VOUCHER VCHTYPE="(\w+)"[\s\S]*?<\/VOUCHER>/g)].map((m) => ({ type: m[1]!, amounts: [...m[0].matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].map((a) => Math.round(Number(a[1]) * 100)), text: m[0] }));
  /** Every opening tag is closed in order: the file is well formed. */
  const wellFormed = (xml: string) => {
    const stack: string[] = [];
    for (const m of xml.replace(/<\?[\s\S]*?\?>/, "").matchAll(/<(\/?)([A-Za-z][\w.]*)[^>]*?(\/?)>/g)) {
      if (m[3]) continue;
      if (m[1]) { if (stack.pop() !== m[2]) return false; } else stack.push(m[2]!);
    }
    return stack.length === 0;
  };

  it("one voucher per entry: receipts, payments, journals and contras by the cash lines, each adding to zero", async () => {
    const out = await new TallyExportService(s.as.accountant).vouchers({ from: "2026-11-01", to: "2026-11-30" });
    const v = body(out.xml);
    expect(out.vouchers).toBe(8);
    expect(v).toHaveLength(8);
    expect(Object.fromEntries(["Receipt", "Payment", "Contra", "Journal"].map((t) => [t, v.filter((x) => x.type === t).length]))).toEqual({ Receipt: 3, Payment: 2, Contra: 1, Journal: 2 });
    expect(v.every((x) => x.amounts.reduce((p, q) => p + q, 0) === 0)).toBe(true);
    expect(v.flatMap((x) => x.amounts).filter((a) => a < 0).reduce((p, q) => p + q, 0)).toBe(-R(224_000));
    expect(v.flatMap((x) => x.amounts).filter((a) => a > 0).reduce((p, q) => p + q, 0)).toBe(R(224_000));
    expect(out.xml).toContain('<LEDGER NAME="Bank" ACTION="Create"><NAME>Bank</NAME><PARENT>Bank Accounts</PARENT>');
    expect(out.xml).toContain("<PARENT>Cash-in-Hand</PARENT>");
    expect(out.xml).toContain("<PARENT>Sundry Debtors</PARENT>");
    expect(out.xml).toContain("<DATE>20261102</DATE>");
    expect(wellFormed(out.xml)).toBe(true);
    expect(out.fileName).toBe("tally-vouchers-2026-11-01-to-2026-11-30.xml");
  });

  it("names and narrations are escaped, so a school cannot break the file or inject tags", async () => {
    await post(inj, "2026-11-04", [{ account: "cash", debit: 100 }, { account: "other_income", credit: 100 }], { memo: 'Tom & Jerry <script>alert("x")</script> \u0001' });
    const out = await new TallyExportService(inj.as.admin).vouchers({ from: "2026-11-01", to: "2026-11-30" });
    expect(out.xml).toContain("Tom &amp; Jerry &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(out.xml).not.toContain("<script>");
    expect(wellFormed(out.xml)).toBe(true);
    await expect(new TallyExportService(inj.as.admin).vouchers({ from: "2026-12-01", to: "2026-11-01" })).rejects.toBeInstanceOf(ValidationError);
    await expect(new TallyExportService(inj.as.teacher).vouchers({ from: "2026-11-01", to: "2026-11-30" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the owner's dashboard", () => {
  it("works with only the books: fees, ageing and budgets stay out until those modules are on", async () => {
    const o = await new FinanceDashboardService(s.as.admin).overview();
    const x = o.extras;
    expect(x).toMatchObject({ ageing: null, budget: null, perStudent: null, unmatchedBankLines: 0 });
    expect(x.fees).toMatchObject({ billedPaise: R(100_000), concessionsPaise: R(4_000), collectedPaise: R(70_000), duePaise: R(26_000) });
    expect(x.fees.links.billed).toMatch(/^\/app\/finance\/accounts\/.+\?from=\d{4}-04-01&to=\d{4}-\d{2}-\d{2}$/);
    expect(x.salary).toMatchObject({ salaryPaise: R(40_000), incomePaise: R(99_500), shareBp: 4020 });
    expect(x.forecast.months).toHaveLength(3);
    expect(x.forecast.openingPaise).toBe(o.cashTotalPaise);
    expect(x.setup.map((t) => [t.key, t.done])).toEqual([["cash", true], ["bank", true], ["upi", false], ["opening", false]]);
    expect(x.setup.find((t) => t.key === "upi")!.href).toContain("next=%2Fapp%2Ffinance");
  });

  it("an auditor with only finance:read sees every number; nobody else without it does", async () => {
    const auditor = { ...s.as.teacher, grants: new Set(["finance:read"]) };
    expect((await new FinanceDashboardService(auditor).overview()).cashTotalPaise).toBeGreaterThan(0);
    expect((await new StatementService(auditor).run({ kind: "balance-sheet", from: "2026-11-01", to: "2026-11-30" })).balanced).toBe(true);
    expect((await new StatementService(auditor).csv({ kind: "trial-balance", from: "2026-11-01", to: "2026-11-30" })).length).toBeGreaterThan(50);
    expect((await new TallyExportService(auditor).vouchers({ from: "2026-11-01", to: "2026-11-30" })).vouchers).toBe(8);
    expect((await new AccountService(auditor).withBalances()).length).toBeGreaterThan(0);
    expect((await new JournalService(auditor).list()).total).toBeGreaterThan(0);
    for (const call of [() => new YearCloseService(auditor).preview(), () => new PeriodService(auditor).close("2026-10-01"), () => new CashAccountService(auditor).transfer({})]) await expect(call()).rejects.toBeInstanceOf(ForbiddenError);
    for (const who of [s.as.teacher, s.as.student, s.as.parent]) {
      await expect(new StatementService(who).run({ kind: "day-book", from: "2026-11-01", to: "2026-11-30" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new TallyExportService(who).vouchers({ from: "2026-11-01", to: "2026-11-30" })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("school B sees none of school A's figures", async () => {
    const r = await run(other.as.admin, "trial-balance", "2026-01-01", "2026-12-31");
    expect(r.report.rows.at(-1)!.cells).toMatchObject({ debit: 0, credit: 0 });
    expect(await new TallyExportService(other.as.admin).vouchers({ from: "2026-01-01", to: "2026-12-31" })).toMatchObject({ vouchers: 0 });
    await expect(run(other.as.admin, "ledger", "2026-01-01", "2026-12-31", { accountId: await accountId(s, "bank") })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("the dashboard with the other modules on", () => {
  const today = todayIST();
  const day = (offset: number) => new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  const TABLES = ["fee_invoices", "exp_bills", "exp_recurring", "exp_budgets", "students", "fee_heads", "fee_plans", "fee_counters"];
  const statements = [
    "create table fee_invoices (id serial, school_id uuid, due_date date, status text, gross_paise bigint, concession_paise bigint default 0, credited_paise bigint default 0, late_paise bigint default 0, paid_paise bigint default 0)",
    "create table exp_bills (id serial, school_id uuid, due_date date, status text, gross_paise bigint, tds_paise bigint default 0, paid_paise bigint default 0)",
    "create table exp_recurring (id serial, school_id uuid, is_active boolean, frequency text, next_on date, ends_on date, due_days int, lines jsonb)",
    "create table exp_budgets (id serial, school_id uuid, fy text, account_id uuid, months jsonb)",
    "create table students (id serial, school_id uuid, status text)",
    "create table fee_heads (id serial, school_id uuid, is_active boolean)",
    "create table fee_plans (id serial, school_id uuid, status text)",
    "create table fee_counters (id serial, school_id uuid)",
  ];
  beforeAll(async () => {
    const chart = await withSchool(dash.id, (tx) => systemAccounts(tx, dash.id));
    await post(dash, "2026-11-02", [{ account: "salaries", debit: R(30_000) }, { account: "bank", credit: R(30_000) }]);
    await post(dash, "2026-11-03", [{ account: "general_expense", debit: R(5_000) }, { account: "bank", credit: R(5_000) }]);
    await post(dash, "2026-08-03", [{ account: "bank", debit: R(900_000) }, { account: "other_income", credit: R(900_000) }]);
    // The other modules are not in this package's test database, so their tables are made here by the owner role and handed to the school role.
    await migrateDb().transaction(async (tx) => {
      for (const q of statements) await tx.execute(sql.raw(q));
      for (const t of TABLES) await tx.execute(sql.raw(`grant select on ${t} to app_school`));
      const id = dash.id, m = (v: number) => JSON.stringify(Array(12).fill(R(v)));
      await tx.execute(sql.raw(`
        insert into fee_invoices (school_id, due_date, status, gross_paise, paid_paise) values
          ('${id}', '${day(10)}', 'issued', ${R(5_000)}, 0), ('${id}', '${day(45)}', 'issued', ${R(8_000)}, ${R(1_000)}),
          ('${id}', '${day(-40)}', 'issued', ${R(3_000)}, 0), ('${id}', '${day(-100)}', 'issued', ${R(2_000)}, 0),
          ('${id}', '${day(-5)}', 'issued', ${R(900)}, ${R(900)}), ('${id}', '${day(5)}', 'draft', ${R(777)}, 0);
        insert into exp_bills (school_id, due_date, status, gross_paise, tds_paise, paid_paise) values
          ('${id}', '${day(5)}', 'approved', ${R(10_000)}, ${R(1_000)}, ${R(2_000)}), ('${id}', '${day(-3)}', 'approved', ${R(4_000)}, 0, 0), ('${id}', '${day(5)}', 'draft', ${R(999)}, 0, 0);
        insert into exp_recurring (school_id, is_active, frequency, next_on, ends_on, due_days, lines) values ('${id}', true, 'monthly', '${day(3)}', null, 7, '[{"amountPaise": ${R(9_000)}}]'::jsonb);
        insert into exp_budgets (school_id, fy, account_id, months) values ('${id}', '${fyOf(today)}', '${chart.general_expense}', '${m(10_000)}'::jsonb);
        insert into students (school_id, status) select '${id}', 'active' from generate_series(1, 40);
        insert into students (school_id, status) select '${id}', 'left' from generate_series(1, 5);
        insert into fee_heads (school_id, is_active) values ('${id}', true);
        insert into fee_invoices (school_id, due_date, status, gross_paise) values ('${id}', '${day(200)}', 'issued', 1);`));
    });
  });
  afterAll(async () => { await migrateDb().transaction(async (tx) => { for (const t of TABLES) await tx.execute(sql.raw(`drop table if exists ${t}`)); }); });

  it("ageing, budget, cost per student, the 90-day forecast and the setup steps read the other modules' tables", async () => {
    const x = (await new FinanceDashboardService(dash.as.admin).overview()).extras;
    expect(x.ageing!.buckets.map((b) => b.paise)).toEqual([R(12_000) + 1, 0, R(3_000), 0, R(2_000)]);
    expect(x.ageing!.buckets.every((b) => b.href.startsWith("/app/fees/dues?bucket="))).toBe(true);
    const months = (Number(today.slice(0, 4)) - Number(`${fyOf(today).slice(0, 4)}`)) * 12 + Number(today.slice(5, 7)) - 4 + 1;
    expect(x.budget).toMatchObject({ toDateBudgetPaise: R(10_000) * months, toDateActualPaise: R(5_000), yearBudgetPaise: R(120_000) });
    expect(x.budget!.rows[0]).toMatchObject({ name: "General expenses", budgetPaise: R(10_000) * months, actualPaise: R(5_000) });
    expect(x.perStudent).toMatchObject({ students: 40, expensePaise: R(35_000), perStudentPaise: Math.round(R(35_000) / 40) });
    expect(x.forecast.months.map((m) => [m.inPaise, m.outPaise])).toEqual([[R(5_000), R(7_000) + R(4_000) + R(9_000)], [R(7_000), R(9_000)], [0, R(9_000)]]);
    expect(x.forecast.months[2]!.closingPaise).toBe(x.forecast.openingPaise + R(5_000) + R(7_000) - R(20_000) - R(9_000) - R(9_000));
    expect(x.forecast.notes.length).toBeGreaterThan(2);
    expect(x.setup.filter((t) => ["heads", "plan", "issued", "counter"].includes(t.key)).map((t) => [t.key, t.done, t.needs])).toEqual([["heads", true, "fees-setup"], ["plan", false, "fees-setup"], ["issued", true, "fees-setup"], ["counter", false, "fees-collect"]]);
    expect(x.setup.find((t) => t.key === "plan")!.href).toBe(`/app/fees/plans?next=${encodeURIComponent("/app/finance")}`);
  });

  it("an open cash counter blocks the year close, a counter the app injects too", async () => {
    await migrateDb().execute(sql.raw(`alter table fee_counters add column closed_at timestamptz; insert into fee_counters (school_id) values ('${dash.id}')`));
    const open = await new YearCloseService(dash.as.admin).preview("2025-26");
    expect(open.checks.find((c) => c.key === "counters")).toMatchObject({ ok: false, blocking: true });
    await migrateDb().execute(sql.raw("update fee_counters set closed_at = now()"));
    const injected = new YearCloseService(dash.as.admin, { blockers: [{ name: "Till", run: async () => ["The front office till is open."] }] });
    expect((await injected.preview("2025-26")).checks.find((c) => c.key === "counters")!.detail).toContain("front office till");
    expect((await new YearCloseService(dash.as.admin).preview("2025-26")).checks.find((c) => c.key === "counters")!.ok).toBe(true);
  });
});

describe("who a request waits for", () => {
  it("names admins and anyone whose custom role holds finance:approve", async () => {
    const extra = await createTestSchool("role-stm", ["finance", "notifications"]);
    const roleId = await withConsole(async (tx) => {
      const [role] = await tx.insert(schoolRoles).values({ schoolId: extra.id, name: "Bursar", base: "staff", grants: ["finance:approve", "finance:read"] }).returning({ id: schoolRoles.id });
      await tx.insert(users).values({ schoolId: extra.id, role: "accountant", loginId: "bursar-stm", name: "Bursar Bhatt", roleId: role!.id });
      const [none] = await tx.insert(schoolRoles).values({ schoolId: extra.id, name: "Clerk", base: "staff", grants: ["finance:read"] }).returning({ id: schoolRoles.id });
      await tx.insert(users).values({ schoolId: extra.id, role: "accountant", loginId: "clerk-stm", name: "Clerk Kumar", roleId: none!.id });
      return role!.id;
    });
    expect(roleId).toBeTruthy();
    const names = await new ApprovalDeskService(extra.as.accountant).approvers(extra.users.accountant);
    expect(names.sort()).toEqual(["Bursar Bhatt", "admin role-stm"]);
  });
});

describe("the nightly job", () => {
  it("takes the checks the worker adds, and the plain export still runs the ledger alone", async () => {
    const jobs = financeJobs([{ name: "Extra", run: async () => [] }]);
    expect(Object.keys(jobs)).toEqual(["finance.control-checks"]);
    expect(Object.keys(plainJobs)).toEqual(["finance.control-checks"]);
  });
});

async function accountId(school: TestSchool, key: SystemAccount) {
  return (await withSchool(school.id, (tx) => systemAccounts(tx, school.id)))[key];
}
