// Turning an approved exit into a final-settlement run, and undoing it. Shared by the approval handler and the exit service.
import { eq } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, NotFoundError } from "@smw/feature-kit";
import { todayIST, monthStart } from "@smw/feature-kit/money";
import { reverseJournal, type Poster } from "@smw/feature-finance/posting";
import { leaveLedger } from "@smw/feature-attendance/schema";
import { users } from "@smw/db";
import { recoverLoans, approveRun, runWithItems } from "./ledger";
import { monthLabel } from "./csv";
import { daysIn } from "./engine";
import { payExits, payItems, payLines, payRuns } from "./schema";

export type ExitLine = (typeof payExits.$inferSelect)["lines"][number];
const sumOf = (lines: ExitLine[], f: (l: ExitLine) => boolean) => lines.filter(f).reduce((a, l) => a + l.amountPaise, 0);
/** Gross, deductions, employer cost and net of a settlement's lines (a claim is paid but is not gross). */
export function exitTotals(lines: ExitLine[]) {
  const gross = sumOf(lines, (l) => l.kind === "earning" && l.code !== "claim"), claims = sumOf(lines, (l) => l.code === "claim");
  const deductions = sumOf(lines, (l) => l.kind === "deduction"), employer = sumOf(lines, (l) => l.kind === "employer");
  return { gross, claims, deductions, employer, net: gross + claims - deductions };
}

/** Make the run of an exit that was just approved and approve it, so it posts and waits for its payout. */
export async function approveExit(tx: Tx, poster: Poster, exitId: string, approvedBy: string) {
  const [x] = await tx.select().from(payExits).where(eq(payExits.id, exitId)).for("update");
  if (!x) throw new NotFoundError("Exit");
  if (x.status !== "pending") throw new ConflictError("This exit is not waiting for approval.");
  const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, x.userId));
  const month = monthStart(x.lastDay), t = exitTotals(x.lines);
  const [run] = await tx.insert(payRuns).values({ schoolId: x.schoolId, kind: "exit", month, label: `Final settlement: ${u?.name ?? "staff"}, ${monthLabel(month)}`, status: "reviewed", createdBy: x.createdBy, totals: { people: 1, skipped: 0, gross: t.gross, claims: t.claims, deductions: t.deductions, employer: t.employer, net: t.net } }).returning();
  const cal = daysIn(month), after = (cal - +x.lastDay.slice(8)) * 2;
  const [item] = await tx.insert(payItems).values({ schoolId: x.schoolId, runId: run!.id, userId: x.userId, calendarDays: cal, paidHalfDays: cal * 2 - after, unpaidHalfDays: after, grossPaise: t.gross, deductionsPaise: t.deductions, employerPaise: t.employer, netPaise: t.net, snapshot: { exitId } }).returning();
  const earned = x.lines.filter((l) => l.amountPaise > 0 || l.kind === "earning");
  if (earned.length) await tx.insert(payLines).values(earned.map((l, sort) => ({ schoolId: x.schoolId, itemId: item!.id, kind: l.kind, code: l.code === "other" ? null : l.code, label: l.label, amountPaise: l.amountPaise, manual: true, note: l.note ?? null, refId: l.code === "loan" ? l.note ?? null : null, sort })));
  await approveRun(tx, poster, run!.id, approvedBy, ["reviewed"]);
  for (const l of x.lines.filter((l) => l.code === "leave_encashment")) {
    const [typeId, half] = (l.note ?? "").split(":");
    if (typeId && Number(half)) await tx.insert(leaveLedger).values({ schoolId: x.schoolId, userId: x.userId, typeId, date: x.lastDay, halfDays: -Number(half), kind: "encash", note: `Paid out at exit: ${l.label}` });
  }
  await tx.update(payExits).set({ status: "approved", runId: run!.id }).where(eq(payExits.id, exitId));
  return run!;
}

/** Undo an approved settlement before any payment: reverse the accrual, the loan recoveries and the leave paid out, and return the exit to a draft. */
export async function undoExit(tx: Tx, poster: Poster, exitId: string, why: string) {
  const [x] = await tx.select().from(payExits).where(eq(payExits.id, exitId)).for("update");
  if (!x || x.status !== "approved" || !x.runId) throw new ConflictError("Only an approved settlement that is not paid yet can be undone.");
  const { run, items, lines } = await runWithItems(tx, x.runId, true);
  if (items.some((i) => i.payout === "paid")) throw new ConflictError("Money has been paid, so this cannot be undone.");
  await reverseJournal(tx, poster, `payroll:run:${run.id}`, { date: todayIST(), memo: `Final settlement undone: ${why}` });
  await recoverLoans(tx, x.schoolId, lines, todayIST(), -1);
  for (const l of x.lines.filter((l) => l.code === "leave_encashment")) {
    const [typeId, half] = (l.note ?? "").split(":");
    if (typeId && Number(half)) await tx.insert(leaveLedger).values({ schoolId: x.schoolId, userId: x.userId, typeId, date: x.lastDay, halfDays: Number(half), kind: "reversed", note: `Settlement undone: ${why}` });
  }
  await tx.update(payRuns).set({ status: "cancelled" }).where(eq(payRuns.id, run.id));
  await tx.update(payExits).set({ status: "draft", runId: null }).where(eq(payExits.id, exitId));
}
