// What approving, recalling and paying a run does to the books. Plain functions: the approval handlers and the services both call them.
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { ConflictError, NotFoundError } from "@smw/feature-kit";
import { monthEnd, todayIST } from "@smw/feature-kit/money";
import { nextNumber, postJournal, reverseJournal, type PostLine, type Poster } from "@smw/feature-finance/posting";
import { finJournals, finTemplates } from "@smw/feature-finance/schema";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { monthLabel } from "./csv";
import { defaultSources, type Sources } from "./sources";
import { ratesOf, repaid, type ItemRow, type LineRow } from "./compute";
import { bankOf } from "./bank";
import { reviewBlockers } from "./review";
import { payComponents, payItems, payLines, payLoanRepayments, payLoans, payProfiles, payRuns } from "./schema";

export type RunRow = typeof payRuns.$inferSelect;
const PF = ["pf_employee", "pf_employer", "eps_employer", "edli", "pf_admin"];
/** The payment key a deduction or employer line is cleared by: an office (pf, esi, pt, tds, lwf), a held account, or "other". Loans are cleared by recovery, never paid out. */
export function remitKeyOf(l: { code: string | null }, accountId?: string | null): string | null {
  const c = l.code ?? "";
  if (PF.includes(c)) return "pf";
  if (c.startsWith("esi")) return "esi";
  if (c === "pt" || c === "tds") return c;
  if (c.startsWith("lwf")) return "lwf";
  if (c === "loan") return null;
  return accountId ? `acct:${accountId}` : "other";
}
const SYSTEM_OF = { pf: "pf_payable", esi: "esi_payable", pt: "pt_payable", tds: "tds_payable", lwf: "lwf_payable", other: "other_deductions" } as const;
/** The ledger account a remittance key pays down. */
export const accountOfKey = (key: string) => (key.startsWith("acct:") ? { id: key.slice(5) } : SYSTEM_OF[key as keyof typeof SYSTEM_OF]);

export async function runWithItems(tx: Tx, runId: string, lock = false) {
  const q = tx.select().from(payRuns).where(eq(payRuns.id, runId));
  const [run] = await (lock ? q.for("update") : q);
  if (!run) throw new NotFoundError("Pay run");
  const items = await tx.select().from(payItems).where(eq(payItems.runId, runId)).orderBy(payItems.createdAt);
  const lines = items.length ? await tx.select().from(payLines).where(inArray(payLines.itemId, items.map((i) => i.id))).orderBy(payLines.sort) : [];
  return { run, items, lines };
}

/** A run's accrual posts once per approval: the first under the plain key, each later one (after a recall) under `:n`. A document key posts only once, so a second approval needs its own. */
const accrualKey = (runId: string, n: number) => (n <= 1 ? `payroll:run:${runId}` : `payroll:run:${runId}:${n - 1}`);
export async function accrualCount(tx: Tx, runId: string): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(finJournals).where(and(eq(finJournals.sourceType, "payroll_run"), eq(finJournals.sourceId, runId), ne(finJournals.kind, "reversal")));
  return r?.n ?? 0;
}
/** Reverse the accrual of the current approval of a run. */
export async function reverseAccrual(tx: Tx, poster: Poster, runId: string, memo: string) {
  return reverseJournal(tx, poster, accrualKey(runId, await accrualCount(tx, runId)), { date: todayIST(), memo });
}

/** The accrual of a run (PRD 5.2): salaries and employer cost against each person's net pay, the statutory payables and loans recovered. */
export async function accrue(tx: Tx, poster: Poster, run: RunRow, items: ItemRow[], lines: LineRow[], date: string) {
  const live = items.filter((i) => !i.skippedReason);
  const refs = [...new Set(lines.filter((l) => l.code === null && l.refId).map((l) => l.refId!))];
  const held = new Map((refs.length ? await tx.select({ id: payComponents.id, accountId: payComponents.accountId }).from(payComponents).where(inArray(payComponents.id, refs)) : []).map((c) => [c.id, c.accountId]));
  const cr = new Map<string, PostLine>();
  const credit = (key: string, line: PostLine) => { const have = cr.get(key); if (have) have.credit = (have.credit ?? 0) + (line.credit ?? 0); else cr.set(key, line); };
  const dr = new Map<string, PostLine>();
  const debit = (account: "salaries" | "employer_contrib", cc: string | null, v: number) => {
    const key = `${account}|${cc ?? ""}`, have = dr.get(key);
    if (have) have.debit = (have.debit ?? 0) + v; else dr.set(key, { account, debit: v, costCentreId: cc });
  };
  const out: PostLine[] = [];
  for (const i of live) {
    const cc = (i.snapshot as { costCentreId?: string | null }).costCentreId ?? null;
    for (const l of lines.filter((x) => x.itemId === i.id)) {
      const v = Number(l.amountPaise);
      if (l.kind === "earning") { if (l.code === "claim") out.push({ account: "claims_payable", debit: v, party: { type: "staff", id: i.userId } }); else debit("salaries", cc, v); continue; }
      if (l.kind === "employer") debit("employer_contrib", cc, v);
      const own = l.code === null && l.refId ? held.get(l.refId) ?? null : null;
      const key = remitKeyOf(l, own);
      if (key === null) credit(`loan:${i.userId}`, { account: "staff_loans", credit: v, party: { type: "staff", id: i.userId } });
      else credit(key, { account: accountOfKey(key), credit: v });
    }
    out.push({ account: "salary_payable", credit: Number(i.netPaise), party: { type: "staff", id: i.userId } });
  }
  const top = Number(run.totals.pfAdminTopUp ?? 0);
  if (top) { debit("employer_contrib", null, top); credit("pf", { account: "pf_payable", credit: top }); }
  return postJournal(tx, poster, {
    date, sourceKey: accrualKey(run.id, (await accrualCount(tx, run.id)) + 1), sourceType: "payroll_run", sourceId: run.id, memo: `Payroll: ${run.label}`,
    lines: [...dr.values(), ...out, ...cr.values()],
  });
}

/** Take back what each EMI line recovered, or put it back (sign -1 undoes). Closes a loan that reaches zero, reopens one that no longer is. */
export async function recoverLoans(tx: Tx, schoolId: string, lines: LineRow[], date: string, sign: 1 | -1) {
  const loanLines = lines.filter((l) => l.code === "loan" && l.refId);
  if (!loanLines.length) return;
  const ids = [...new Set(loanLines.map((l) => l.refId!))];
  const loans = await tx.select().from(payLoans).where(inArray(payLoans.id, ids)).for("update");
  const paid = await repaid(tx, ids);
  for (const l of loanLines) {
    const loan = loans.find((x) => x.id === l.refId);
    if (!loan) throw new NotFoundError("Loan");
    const owed = Number(loan.amountPaise) - (paid.get(loan.id) ?? 0), v = Number(l.amountPaise);
    if (sign === 1 && v > owed) throw new ConflictError("A loan balance changed after this run was worked out. Recompute the run.");
    await tx.insert(payLoanRepayments).values({ schoolId, loanId: loan.id, itemId: l.itemId, date, amountPaise: sign * v });
    paid.set(loan.id, (paid.get(loan.id) ?? 0) + sign * v);
  }
  for (const loan of loans) {
    const left = Number(loan.amountPaise) - (paid.get(loan.id) ?? 0);
    const status = left <= 0 ? "closed" : loan.status === "closed" ? "active" : loan.status;
    if (status !== loan.status) await tx.update(payLoans).set({ status }).where(eq(payLoans.id, loan.id));
  }
}

/** Approve a reviewed run: number the payslips, recover the EMIs, freeze the rates and post the accrual. */
export async function approveRun(tx: Tx, poster: Poster, runId: string, approvedBy: string, allowed: RunRow["status"][] = ["reviewed"], sources: Sources = defaultSources) {
  const { run, items, lines } = await runWithItems(tx, runId, true);
  if (!allowed.includes(run.status)) throw new ConflictError(`This run is ${run.status}, so it cannot be approved now.`);
  const live = items.filter((i) => !i.skippedReason);
  if (!live.length) throw new ConflictError("There is nobody in this run.");
  // The same checks as review, once more: bank details, typed amounts and rates can change between review and approval.
  const [profiles, names] = await Promise.all([
    tx.select().from(payProfiles).where(inArray(payProfiles.userId, live.map((i) => i.userId))),
    tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, live.map((i) => i.userId))),
  ]);
  const blockers = reviewBlockers(run, live, new Map(names.map((n) => [n.id, n.name])), lines, profiles);
  if (blockers.length) throw new ConflictError(`${blockers.length} thing${blockers.length === 1 ? "" : "s"} must be fixed first: ${blockers[0]!.message} Withdraw the request and reopen the run to fix it.`);
  const today = todayIST(), date = run.kind === "monthly" && monthEnd(run.month) < today ? monthEnd(run.month) : today;
  const [tpl] = await tx.select({ v: finTemplates.version }).from(finTemplates).where(and(eq(finTemplates.kind, "payslip"), eq(finTemplates.isCurrent, true)));
  const numbered: typeof live = [];
  for (const i of live) {
    if (i.payslipNo) continue;
    numbered.push(i);
    await tx.update(payItems).set({ payslipNo: await nextNumber(tx, run.schoolId, "payslip", date), templateVersion: tpl?.v ?? 0 }).where(eq(payItems.id, i.id));
  }
  // A payslip is the person's own the moment it gets a number (a re-approved run keeps its numbers and tells nobody twice). The words never say the amount.
  await NotificationWriter.insert(tx, run.schoolId, numbered.map((i) => ({
    userId: i.userId, topic: "payroll.payslip" as const, title: `Your payslip for ${monthLabel(run.month)} is ready`, body: "Sign in to open it.", href: "/app/payroll/me",
    subject: { type: "payslip", id: i.id }, privateBody: true,
  })));
  // Freeze how each person is paid: payouts and the bank file use this, whatever the profile says later.
  for (const i of live) await tx.update(payItems).set({ snapshot: { ...i.snapshot, bank: bankOf(profiles.find((p) => p.userId === i.userId)) } }).where(eq(payItems.id, i.id));
  const liveIds = new Set(live.map((i) => i.id));
  await recoverLoans(tx, run.schoolId, lines.filter((l) => liveIds.has(l.itemId)), today, 1);
  await accrue(tx, poster, run, items, lines, date);
  const claimIds = lines.filter((l) => l.code === "claim" && liveIds.has(l.itemId)).map((l) => l.refId!);
  if (claimIds.length) await sources.claims.markPaid(tx, claimIds, { runId, date });
  const [row] = await tx.update(payRuns).set({ status: "approved", approvedBy, approvedAt: new Date(), rates: ratesOf(items) }).where(eq(payRuns.id, runId)).returning();
  return row!;
}

/** Undo an approved run before any money went out: reverse the accrual and the EMIs and reopen it as a draft. */
export async function recallRun(tx: Tx, poster: Poster, runId: string, reason: string, sources: Sources = defaultSources) {
  const { run, items, lines } = await runWithItems(tx, runId, true);
  if (run.status !== "approved") throw new ConflictError(run.status === "paid" ? "This run is paid, so it cannot be recalled." : "Only an approved run can be recalled.");
  if (run.kind === "exit") throw new ConflictError("A final settlement is undone from the exit page.");
  if (items.some((i) => i.payout === "paid")) throw new ConflictError("Some people are already paid, so this run cannot be recalled.");
  await reverseAccrual(tx, poster, runId, `Payroll recalled: ${run.label}. ${reason}`);
  const liveIds = new Set(items.filter((i) => !i.skippedReason).map((i) => i.id));
  await recoverLoans(tx, run.schoolId, lines.filter((l) => liveIds.has(l.itemId)), todayIST(), -1);
  await sources.claims.unmark(tx, runId);
  const [row] = await tx.update(payRuns).set({ status: "draft", approvedBy: null, approvedAt: null }).where(eq(payRuns.id, runId)).returning();
  await tx.update(payItems).set({ payout: "pending", failReason: null }).where(and(eq(payItems.runId, runId), sql`${payItems.payout} <> 'paid'`));
  return row!;
}
