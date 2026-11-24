import { z } from "zod";
import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, NotFoundError, countIn, pgErrorCode, type Ctx } from "@smw/feature-kit";
import { addDays, addMonths, fyOf, fyRange, rupees, todayIST } from "@smw/feature-kit/money";
import type { ApprovalHandler } from "../approvals";
import { postJournal, reverseJournal, type Poster } from "../posting";
import { systemAccounts } from "../chart";
import { finApprovals, finJournals, finPeriods, finYearCloses } from "../schema";
import { unmatchedBankLines } from "./bank";
import { FinanceService } from "./common";
import { runControlChecks, type ControlCheck } from "./control";
import { YEAR_CLOSE_TYPE } from "./statements";

export interface CloseCheck { key: string; label: string; ok: boolean; /** A blocking check that fails stops the close. */ blocking: boolean; detail: string; href?: string }
export interface CloseLine { accountId: string; code: string; name: string; debitPaise: number; creditPaise: number }
export interface YearClosePreview {
  fy: string; from: string; to: string;
  current: (typeof finYearCloses.$inferSelect) | null;
  checks: CloseCheck[]; ready: boolean;
  lines: CloseLine[]; incomeTotalPaise: number; expenseTotalPaise: number; surplusPaise: number;
  reopenPending: boolean;
  /** Closing was asked for and waits for a decision. */
  closePending: boolean;
}
export interface YearCloseOptions {
  /** More ledger checks (fees, expenses, payroll), composed by the app. */
  checks?: ControlCheck[];
  /** Anything else that must be finished before the year can close, such as cash counters still open. Each problem it returns blocks. */
  blockers?: ControlCheck[];
}

const FY = z.string().regex(/^\d{4}-\d{2}$/, "Choose a financial year like 2026-27.");
const reasonInput = z.object({ reason: z.string().trim().min(3, "Say why the year is being reopened.").max(300) });
const here = (fy: string) => `/app/finance/year-close?fy=${fy}`;
const prevFy = (fy: string) => { const y = Number(fy.slice(0, 4)) - 1; return `${y}-${String((y + 1) % 100).padStart(2, "0")}`; };

/** The key under which a run's closing entry is posted: the first run is `finance:year:<fy>`, a later one (after a reopen) adds its number. */
export const yearKey = (fy: string, run: number) => `finance:year:${fy}${run > 1 ? `:${run}` : ""}`;

/** Income and expense accounts with what stands on them up to a day, closing entries of earlier years included. */
async function pnlBalances(tx: Tx, upTo: string) {
  const res = await tx.execute(sql`
    select a.id, a.code, a.name, a.type, coalesce(sum(l.debit_paise - l.credit_paise), 0) as net
    from fin_accounts a
    join fin_journal_lines l on l.account_id = a.id join fin_journals j on j.id = l.journal_id and j.date <= ${upTo}
    where a.type in ('income', 'expense') group by a.id having coalesce(sum(l.debit_paise - l.credit_paise), 0) <> 0 order by a.code`);
  return [...res].map((r) => { const x = r as Record<string, unknown>; return { id: String(x.id), code: String(x.code), name: String(x.name), type: String(x.type), net: Number(x.net) }; });
}

/** The entry that moves the year's income and expense to the accumulated surplus. Each account is cleared by its opposite; the surplus account takes the difference. */
function closingLines(balances: Awaited<ReturnType<typeof pnlBalances>>, surplusAccountId: string) {
  const lines: CloseLine[] = balances.map((b) => ({ accountId: b.id, code: b.code, name: b.name, debitPaise: b.net < 0 ? -b.net : 0, creditPaise: b.net > 0 ? b.net : 0 }));
  const t = balances.reduce((s, b) => s + b.net, 0);
  if (t) lines.push({ accountId: surplusAccountId, code: "3010", name: "Accumulated surplus", debitPaise: t > 0 ? t : 0, creditPaise: t < 0 ? -t : 0 });
  return { lines, surplusPaise: -t };
}

export class YearCloseService extends FinanceService {
  constructor(ctx: Ctx, private readonly opts: YearCloseOptions = {}) { super(ctx); }

  private async latest(tx: Tx, fy: string, lock = false) {
    const q = tx.select().from(finYearCloses).where(eq(finYearCloses.fy, fy)).orderBy(desc(finYearCloses.run)).limit(1);
    return (await (lock ? q.for("update") : q))[0] ?? null;
  }

  private async checklist(tx: Tx, fy: string): Promise<CloseCheck[]> {
    const [from, to] = fyRange(fy), today = todayIST();
    const [locks, mismatches, [pending], unmatched, counters, earlier] = await Promise.all([
      tx.select().from(finPeriods).where(and(eq(finPeriods.status, "closed"), sql`${finPeriods.month} between ${from} and ${to}`)),
      runControlChecks(tx, this.ctx.schoolId, this.opts.checks),
      tx.select({ n: sql<number>`count(*)::int` }).from(finApprovals).where(and(eq(finApprovals.status, "pending"), ne(finApprovals.kind, "finance.year-close"))),
      unmatchedBankLines(tx),
      countIn(tx, "fee_counters", sql`closed_at is null`),
      pnlBalances(tx, addDays(from, -1)),
    ]);
    const extra = (await Promise.all((this.opts.blockers ?? []).map((b) => b.run(tx, this.ctx.schoolId)))).flat();
    const open = counters + extra.length;
    const months = 12 - locks.length, pend = Number(pending?.n ?? 0);
    return [
      { key: "ended", label: "The year has ended", ok: to < today, blocking: true, detail: to < today ? `It ended on ${to}.` : `It ends on ${to}. A year cannot close before then.` },
      { key: "earlier", label: "The year before is closed", ok: earlier.length === 0, blocking: true, detail: earlier.length ? `${prevFy(fy)} still has income and expense that were not carried to the surplus. Close it first.` : "Nothing is left over from earlier years.", href: earlier.length ? here(prevFy(fy)) : undefined },
      { key: "months", label: "Every month is closed", ok: months === 0, blocking: false, detail: months ? `${months} of 12 months are still open. Closing the year closes them.` : "All 12 months are closed.", href: months ? "/app/finance/settings?tab=periods" : undefined },
      { key: "checks", label: "The books agree with each other", ok: mismatches.length === 0, blocking: true, detail: mismatches.length ? `${mismatches.length} problem${mismatches.length === 1 ? "" : "s"}. First: ${mismatches[0]!.problem}` : "Every check is green.", href: mismatches.length ? "/app/finance" : undefined },
      { key: "approvals", label: "No request is waiting for a decision", ok: pend === 0, blocking: true, detail: pend ? `${pend} request${pend === 1 ? "" : "s"} still need a decision.` : "Nothing is waiting.", href: pend ? "/app/finance/approvals" : undefined },
      { key: "bank", label: "Every bank line is matched", ok: unmatched === 0, blocking: true, detail: unmatched ? `${unmatched} bank line${unmatched === 1 ? " is" : "s are"} not matched to an entry.` : "Nothing is left unmatched.", href: unmatched ? "/app/finance/banking" : undefined },
      { key: "counters", label: "No cash counter is open", ok: open === 0, blocking: true, detail: open ? `${open} counter${open === 1 ? " is" : "s are"} still open.${extra[0] ? ` ${extra[0]}` : ""}` : "Every counter is closed.", href: open ? "/app/fees" : undefined },
    ];
  }

  /** What closing this year would do: the checklist and the entry that carries income and expense to the surplus. Changes nothing. */
  async preview(fyInput: string = fyOf(todayIST())): Promise<YearClosePreview> {
    const fy = this.parse(FY, fyInput), [from, to] = fyRange(fy);
    return this.read("close", async (tx) => {
      const system = await systemAccounts(tx, this.ctx.schoolId);
      const [balances, checks, current] = await Promise.all([pnlBalances(tx, to), this.checklist(tx, fy), this.latest(tx, fy)]);
      const [pending] = current ? await tx.select({ n: sql<number>`count(*)::int` }).from(finApprovals).where(and(eq(finApprovals.kind, "finance.year-reopen"), eq(finApprovals.status, "pending"), eq(finApprovals.refId, current.id))) : [];
      const { lines, surplusPaise } = closingLines(balances, system.surplus);
      const income = balances.filter((b) => b.type === "income").reduce((s, b) => s - b.net, 0), expense = balances.filter((b) => b.type === "expense").reduce((s, b) => s + b.net, 0);
      return {
        fy, from, to, current, checks, ready: checks.every((c) => c.ok || !c.blocking) && current?.status !== "closed",
        lines, incomeTotalPaise: income, expenseTotalPaise: expense, surplusPaise, reopenPending: Number(pending?.n ?? 0) > 0, closePending: current?.status === "pending",
      };
    });
  }

  private async assertClosable(tx: Tx, fy: string) {
    const stop = (await this.checklist(tx, fy)).find((c) => c.blocking && !c.ok);
    if (stop) throw new ConflictError(`${stop.label}: ${stop.detail}`);
  }

  /** Ask for the year to be closed. Nothing is posted or locked until another admin agrees (a school's only admin decides alone, with a reason). */
  async requestClose(fyInput: string) {
    this.authorize("close", "write");
    const fy = this.parse(FY, fyInput), [, to] = fyRange(fy);
    return this.write("close", async (tx) => {
      const last = await this.latest(tx, fy, true);
      if (last?.status === "closed") throw new ConflictError(`${fy} is already closed. Ask for it to be reopened, with a reason, if something was missed.`);
      if (last?.status === "pending") throw new ConflictError(`Closing ${fy} is already waiting for a decision.`);
      await this.assertClosable(tx, fy);
      const { surplusPaise } = closingLines(await pnlBalances(tx, to), (await systemAccounts(tx, this.ctx.schoolId)).surplus);
      let row: { id: string } | undefined;
      try {
        [row] = await tx.insert(finYearCloses).values({ schoolId: this.ctx.schoolId, fy, run: (last?.run ?? 0) + 1, status: "pending", surplusPaise, closedBy: this.ctx.userId }).returning({ id: finYearCloses.id });
      } catch (e) { if (pgErrorCode(e) === "23505") throw new ConflictError(`${fy} is being closed by someone else.`); throw e; }
      const a = await this.askApproval(tx, { kind: "finance.year-close", refType: "YearClose", refId: row!.id, title: `Close financial year ${fy}`, amountPaise: Math.abs(surplusPaise), reason: `${surplusPaise >= 0 ? "Surplus" : "Deficit"} of ${rupees(Math.abs(surplusPaise))} moves to the accumulated surplus and twelve months lock.`, href: here(fy) });
      return { fy, approvalId: a.id };
    }, (r) => ({ action: "request-close", entity: "Financial year", summary: `Asked to close financial year ${r.fy}`, meta: { fy: r.fy } }));
  }

  /** The decision: carry income and expense to the surplus, then lock all twelve months. Runs inside the deciding transaction. */
  async closeIn(tx: Tx, id: string, by: Poster) {
      const [last] = await tx.select().from(finYearCloses).where(eq(finYearCloses.id, id)).for("update");
      if (last?.status !== "pending") throw new NotFoundError("Year close");
      const { fy, run } = last, [, to] = fyRange(fy);
      await this.assertClosable(tx, fy);
      const system = await systemAccounts(tx, this.ctx.schoolId);
      const { lines, surplusPaise } = closingLines(await pnlBalances(tx, to), system.surplus);
      const months = Array.from({ length: 12 }, (_, i) => addMonths(fyRange(fy)[0], i));
      // The closing entry belongs on the last day of the year even when that month was already closed, so the month is opened for this one entry and locked again with the rest.
      await tx.insert(finPeriods).values({ schoolId: this.ctx.schoolId, month: months[11]!, status: "open", reason: null, changedBy: this.ctx.userId }).onConflictDoUpdate({ target: [finPeriods.schoolId, finPeriods.month], set: { status: "open", reason: null } });
      const posted = await postJournal(tx, by, {
        date: to, sourceKey: yearKey(fy, run), sourceType: YEAR_CLOSE_TYPE, kind: "auto", memo: `Year-end closing ${fy}: income and expenditure carried to the surplus`,
        lines: lines.map((l) => ({ account: { id: l.accountId }, debit: l.debitPaise, credit: l.creditPaise })),
      });
      for (const month of months) await tx.insert(finPeriods).values({ schoolId: this.ctx.schoolId, month, status: "closed", reason: `Year ${fy} closed`, changedBy: this.ctx.userId }).onConflictDoUpdate({ target: [finPeriods.schoolId, finPeriods.month], set: { status: "closed", reason: `Year ${fy} closed`, changedBy: this.ctx.userId } });
      await tx.update(finYearCloses).set({ journalId: posted?.id ?? null, status: "closed", surplusPaise }).where(eq(finYearCloses.id, id));
      await this.audit(tx, { action: "year-close", entity: "Financial year", entityId: posted?.id ?? null, summary: `Closed financial year ${fy}: ${surplusPaise >= 0 ? "surplus" : "deficit"} of ${rupees(Math.abs(surplusPaise))} carried forward`, meta: { fy, run } });
  }

  /** The app merges this with the other handlers, with the checks every money module adds. */
  static handler(opts: YearCloseOptions = {}): ApprovalHandler {
    return {
      approve: (tx, a, actor) => new YearCloseService(actor, opts).closeIn(tx, a.refId, { schoolId: a.schoolId, userId: a.requestedBy }),
      async reject(tx, a) { await tx.delete(finYearCloses).where(and(eq(finYearCloses.id, a.refId), eq(finYearCloses.status, "pending"))); },
    };
  }

  /** Ask to reopen a closed year. An admin other than the one who asks decides; nothing changes until then. */
  async requestReopen(fyInput: string, input: unknown) {
    this.authorize("close", "write");
    const fy = this.parse(FY, fyInput), { reason } = this.parse(reasonInput, input);
    return this.write("close", async (tx) => {
      const c = await this.latest(tx, fy, true);
      if (c?.status !== "closed") throw new ConflictError(`${fy} is not closed.`);
      const a = await this.askApproval(tx, { kind: "finance.year-reopen", refType: "YearClose", refId: c.id, title: `Reopen financial year ${fy}`, amountPaise: Math.abs(c.surplusPaise), reason, href: here(fy) });
      return { approvalId: a.id, fy };
    }, (r) => ({ action: "request-reopen", entity: "Financial year", summary: `Asked to reopen financial year ${r.fy}`, meta: { fy: r.fy } }));
  }

  /** Every year closed so far, newest first. */
  async history() {
    return this.read("close", (tx) => tx.select().from(finYearCloses).where(ne(finYearCloses.status, "pending")).orderBy(desc(finYearCloses.fy), desc(finYearCloses.run)));
  }
}

/** Runs inside the deciding transaction of `finance.year-reopen`: undo the closing entry and open the twelve months. */
export async function reopenYear(tx: Tx, by: Poster, closeId: string, reason: string) {
  const [c] = await tx.select().from(finYearCloses).where(eq(finYearCloses.id, closeId)).for("update");
  if (!c) throw new NotFoundError("Year close");
  if (c.status !== "closed") throw new ConflictError(`${c.fy} was already reopened.`);
  const [later] = await tx.select({ fy: finYearCloses.fy }).from(finYearCloses).where(and(gt(finYearCloses.fy, c.fy), eq(finYearCloses.status, "closed"))).limit(1);
  if (later) throw new ConflictError(`${later.fy} was closed after this year. Reopen it first, so its opening figures stay right.`);
  const [from, to] = fyRange(c.fy);
  for (let i = 0; i < 12; i++) await tx.insert(finPeriods).values({ schoolId: by.schoolId, month: addMonths(from, i), status: "open", reason: `Year ${c.fy} reopened: ${reason}`, changedBy: by.userId }).onConflictDoUpdate({ target: [finPeriods.schoolId, finPeriods.month], set: { status: "open", reason: `Year ${c.fy} reopened: ${reason}`, changedBy: by.userId } });
  if (c.journalId) {
    const [j] = await tx.select({ sourceKey: finJournals.sourceKey }).from(finJournals).where(eq(finJournals.id, c.journalId));
    await reverseJournal(tx, by, j!.sourceKey, { date: to, memo: `Reopened ${c.fy}: ${reason}` });
  }
  await tx.update(finYearCloses).set({ status: "reopened", reopenReason: reason, reopenedBy: by.userId, reopenedAt: new Date() }).where(eq(finYearCloses.id, c.id));
  return c.fy;
}
