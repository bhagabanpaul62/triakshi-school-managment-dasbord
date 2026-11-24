import { eq, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { finAccounts, finCashAccounts, finJournalLines, finJournals } from "../schema";
import { cashBalances } from "./cash";
import { FinanceService } from "./common";

/** One nightly check: the problems it found, in plain words (none = fine). Other modules supply theirs; this file imports none of them. */
export interface ControlCheck { name: string; run(tx: Tx, schoolId: string): Promise<string[]> }
export interface Mismatch { check: string; problem: string }

const ledger: ControlCheck = {
  name: "Ledger",
  async run(tx) {
    const problems: string[] = [];
    const bad = await tx.select({ number: finJournals.number, net: sql<string>`coalesce(sum(${finJournalLines.debitPaise} - ${finJournalLines.creditPaise}), 0)`, lines: sql<number>`count(${finJournalLines.id})::int` })
      .from(finJournals).leftJoin(finJournalLines, eq(finJournalLines.journalId, finJournals.id)).groupBy(finJournals.id)
      .having(sql`coalesce(sum(${finJournalLines.debitPaise} - ${finJournalLines.creditPaise}), 0) <> 0 or count(${finJournalLines.id}) = 0`).limit(20);
    for (const b of bad) problems.push(b.lines ? `Entry ${b.number} does not balance (off by ${Math.abs(Number(b.net)) / 100} rupees).` : `Entry ${b.number} has no lines.`);

    const [all] = await tx.select({ net: sql<string>`coalesce(sum(${finJournalLines.debitPaise} - ${finJournalLines.creditPaise}), 0)` }).from(finJournalLines);
    if (Number(all?.net ?? 0) !== 0) problems.push("The trial balance is not zero: total debits and total credits differ.");

    const [accounts, balances] = await Promise.all([
      tx.select({ id: finCashAccounts.id, name: finCashAccounts.name, kind: finCashAccounts.kind, type: finAccounts.type }).from(finCashAccounts).innerJoin(finAccounts, eq(finAccounts.id, finCashAccounts.accountId)),
      cashBalances(tx),
    ]);
    for (const c of accounts) {
      if (c.type !== "asset") problems.push(`${c.name} is not an asset account in the chart.`);
      if (c.kind === "cash" && (balances.get(c.id) ?? 0) < 0) problems.push(`${c.name} shows less than zero cash. A receipt or opening balance is missing.`);
    }
    return problems;
  },
};

/** Run the ledger check plus any the caller passes (the app and worker compose fees, expenses and payroll checks). One that crashes is reported, not allowed to hide the rest. */
export async function runControlChecks(tx: Tx, schoolId: string, extra: ControlCheck[] = []): Promise<Mismatch[]> {
  const out: Mismatch[] = [];
  for (const c of [ledger, ...extra]) {
    try { for (const problem of await c.run(tx, schoolId)) out.push({ check: c.name, problem }); }
    catch (e) { console.error(JSON.stringify({ level: "error", msg: "control check failed", check: c.name, err: String(e) })); out.push({ check: c.name, problem: "This check could not run." }); }
  }
  return out;
}

export class ControlService extends FinanceService {
  async checks(extra: ControlCheck[] = []): Promise<Mismatch[]> {
    return this.read("read", (tx) => runControlChecks(tx, this.ctx.schoolId, extra));
  }
}
