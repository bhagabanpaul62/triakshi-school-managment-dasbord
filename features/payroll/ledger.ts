// What approving, recalling and paying a run does to the books. Plain functions: the approval handlers and the services both call them.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, NotFoundError } from "@smw/feature-kit";
import { monthEnd, todayIST } from "@smw/feature-kit/money";
import { nextNumber, postJournal, reverseJournal, type PostLine, type Poster } from "@smw/feature-finance/posting";
import { finTemplates } from "@smw/feature-finance/schema";
import { ratesOf, repaid, type ItemRow, type LineRow } from "./compute";
import { payItems, payLines, payLoanRepayments, payLoans, payRuns } from "./schema";

export type RunRow = typeof payRuns.$inferSelect;
const PF = ["pf_employee", "pf_employer", "eps_employer", "edli", "pf_admin"];
const ACCOUNT_OF = (l: { kind: string; code: string | null }) => {
  const c = l.code ?? "";
  if (PF.includes(c)) return "pf_payable" as const;
  if (c.startsWith("esi")) return "esi_payable" as const;
  if (c === "pt") return "pt_payable" as const;
  if (c === "tds") return "tds_payable" as const;
  if (c.startsWith("lwf")) return "lwf_payable" as const;
  if (c === "loan") return "staff_loans" as const;
  return l.kind === "employer" ? "gratuity_payable" as const : "other_deductions" as const;
};

export async function runWithItems(tx: Tx, runId: string, lock = false) {
  const q = tx.select().from(payRuns).where(eq(payRuns.id, runId));
  const [run] = await (lock ? q.for("update") : q);
  if (!run) throw new NotFoundError("Pay run");
  const items = await tx.select().from(payItems).where(eq(payItems.runId, runId)).orderBy(payItems.createdAt);
  const lines = items.length ? await tx.select().from(payLines).where(inArray(payLines.itemId, items.map((i) => i.id))).orderBy(payLines.sort) : [];
  return { run, items, lines };
}

/** The accrual of a run (PRD 5.2): salaries and employer cost against each person's net pay, the statutory payables and loans recovered. */
export async function accrue(tx: Tx, poster: Poster, run: RunRow, items: ItemRow[], lines: LineRow[], date: string) {
  const live = items.filter((i) => !i.skippedReason);
  const cr = new Map<string, PostLine>();
  const credit = (key: string, line: PostLine) => { const have = cr.get(key); if (have) have.credit = (have.credit ?? 0) + (line.credit ?? 0); else cr.set(key, line); };
  let salaries = 0, claims = 0, employer = 0;
  const out: PostLine[] = [];
  for (const i of live) {
    for (const l of lines.filter((x) => x.itemId === i.id)) {
      const v = Number(l.amountPaise);
      if (l.kind === "earning") { if (l.code === "claim") claims += v; else salaries += v; continue; }
      if (l.kind === "employer") employer += v;
      const account = ACCOUNT_OF(l);
      if (account === "staff_loans") credit(`loan:${i.userId}`, { account, credit: v, party: { type: "staff", id: i.userId } });
      else credit(account, { account, credit: v });
    }
    out.push({ account: "salary_payable", credit: Number(i.netPaise), party: { type: "staff", id: i.userId } });
  }
  const top = Number(run.totals.pfAdminTopUp ?? 0);
  if (top) { employer += top; credit("pf_payable", { account: "pf_payable", credit: top }); }
  const name = `${run.label}`;
  return postJournal(tx, poster, {
    date, sourceKey: `payroll:run:${run.id}`, sourceType: "payroll_run", sourceId: run.id, memo: `Payroll: ${name}`,
    lines: [{ account: "salaries", debit: salaries }, { account: "claims_payable", debit: claims }, { account: "employer_contrib", debit: employer }, ...out, ...cr.values()],
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
export async function approveRun(tx: Tx, poster: Poster, runId: string, approvedBy: string, allowed: RunRow["status"][] = ["reviewed"]) {
  const { run, items, lines } = await runWithItems(tx, runId, true);
  if (!allowed.includes(run.status)) throw new ConflictError(`This run is ${run.status}, so it cannot be approved now.`);
  const live = items.filter((i) => !i.skippedReason);
  if (!live.length) throw new ConflictError("There is nobody in this run.");
  if (live.some((i) => Number(i.netPaise) < 0)) throw new ConflictError("Someone's pay is below zero. Fix it first.");
  const today = todayIST(), date = run.kind === "monthly" && monthEnd(run.month) < today ? monthEnd(run.month) : today;
  const [tpl] = await tx.select({ v: finTemplates.version }).from(finTemplates).where(and(eq(finTemplates.kind, "payslip"), eq(finTemplates.isCurrent, true)));
  for (const i of live) {
    if (i.payslipNo) continue;
    await tx.update(payItems).set({ payslipNo: await nextNumber(tx, run.schoolId, "payslip", date), templateVersion: tpl?.v ?? 0 }).where(eq(payItems.id, i.id));
  }
  const liveIds = new Set(live.map((i) => i.id));
  await recoverLoans(tx, run.schoolId, lines.filter((l) => liveIds.has(l.itemId)), today, 1);
  await accrue(tx, poster, run, items, lines, date);
  const [row] = await tx.update(payRuns).set({ status: "approved", approvedBy, approvedAt: new Date(), rates: ratesOf(items) }).where(eq(payRuns.id, runId)).returning();
  return row!;
}

/** Undo an approved run before any money went out: reverse the accrual and the EMIs and reopen it as a draft. */
export async function recallRun(tx: Tx, poster: Poster, runId: string, reason: string) {
  const { run, items, lines } = await runWithItems(tx, runId, true);
  if (run.status !== "approved") throw new ConflictError(run.status === "paid" ? "This run is paid, so it cannot be recalled." : "Only an approved run can be recalled.");
  if (run.kind === "exit") throw new ConflictError("A final settlement is undone from the exit page.");
  if (items.some((i) => i.payout === "paid")) throw new ConflictError("Some people are already paid, so this run cannot be recalled.");
  await reverseJournal(tx, poster, `payroll:run:${runId}`, { date: todayIST(), memo: `Payroll recalled: ${run.label}. ${reason}` });
  const liveIds = new Set(items.filter((i) => !i.skippedReason).map((i) => i.id));
  await recoverLoans(tx, run.schoolId, lines.filter((l) => liveIds.has(l.itemId)), todayIST(), -1);
  const [row] = await tx.update(payRuns).set({ status: "draft", approvedBy: null, approvedAt: null }).where(eq(payRuns.id, runId)).returning();
  await tx.update(payItems).set({ payout: "pending", failReason: null }).where(and(eq(payItems.runId, runId), sql`${payItems.payout} <> 'paid'`));
  return row!;
}
