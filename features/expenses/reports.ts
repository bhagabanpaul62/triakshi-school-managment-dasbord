import { and, desc, eq, sql } from "drizzle-orm";
import { addDays, addMonths, fyOf, fyRange, monthStart, todayIST } from "@smw/feature-kit/money";
import { finAccounts, finCostCentres, finJournalLines, finJournals } from "@smw/feature-finance/schema";
import { ExpenseService } from "./base";
import { RecurringService } from "./recurring";
import { BudgetService } from "./budgets";
import { expBills, expVendors } from "./schema";
import { billState, openOf, netOf } from "./bills";

const AGES = [["Not due", -Infinity, 0], ["1 to 30 days", 1, 30], ["31 to 60 days", 31, 60], ["61 to 90 days", 61, 90], ["Over 90 days", 91, Infinity]] as const;

/** Numbers for the expenses dashboard and reports. Spend comes from the ledger, so it matches the books. */
export class ExpenseReportService extends ExpenseService {
  /** Payables by how late they are. One aggregate. */
  async ageing(today = todayIST()) {
    return this.read("read", async (tx) => {
      const rows = await tx.select({ d: sql<number>`(${today}::date - ${expBills.dueDate})::int`, v: sql<string>`sum(${expBills.grossPaise} - ${expBills.tdsPaise} - ${expBills.paidPaise})` })
        .from(expBills).where(and(eq(expBills.status, "approved"), sql`${expBills.paidPaise} < ${expBills.grossPaise} - ${expBills.tdsPaise}`)).groupBy(expBills.dueDate);
      return AGES.map(([label, lo, hi], i) => ({ label, paise: rows.filter((r) => r.d >= lo && r.d <= hi).reduce((s, r) => s + Number(r.v), 0), href: `/app/expenses/bills?status=${i === 0 ? "unpaid" : "overdue"}` }));
    });
  }

  private async spendBy(from: string, to: string, by: "account" | "centre" | "month") {
    return this.read("read", async (tx) => {
      const net = sql`sum(${finJournalLines.debitPaise} - ${finJournalLines.creditPaise})`;
      const where = and(eq(finAccounts.type, "expense"), sql`${finJournals.date} between ${from} and ${to}`);
      if (by === "month") return (await tx.select({ k: sql<string>`to_char(${finJournals.date}, 'YYYY-MM')`, v: net }).from(finJournalLines).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId)).innerJoin(finAccounts, eq(finAccounts.id, finJournalLines.accountId)).where(where).groupBy(sql`to_char(${finJournals.date}, 'YYYY-MM')`)).map((r) => ({ key: r.k, label: r.k, paise: Number(r.v) }));
      if (by === "account") return (await tx.select({ id: finAccounts.id, k: finAccounts.name, v: net }).from(finJournalLines).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId)).innerJoin(finAccounts, eq(finAccounts.id, finJournalLines.accountId)).where(where).groupBy(finAccounts.id, finAccounts.name).orderBy(desc(net))).map((r) => ({ key: r.id, label: r.k, paise: Number(r.v) })).filter((r) => r.paise > 0);
      return (await tx.select({ id: sql<string>`coalesce(${finCostCentres.id}::text, 'none')`, k: sql<string>`coalesce(${finCostCentres.name}, 'No cost centre')`, v: net }).from(finJournalLines).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId)).innerJoin(finAccounts, eq(finAccounts.id, finJournalLines.accountId)).leftJoin(finCostCentres, eq(finCostCentres.id, finJournalLines.costCentreId)).where(where).groupBy(finCostCentres.id, finCostCentres.name).orderBy(desc(net))).map((r) => ({ key: r.id, label: r.k, paise: Number(r.v) })).filter((r) => r.paise > 0);
    });
  }
  byAccount(from: string, to: string) { return this.spendBy(from, to, "account"); }
  byCostCentre(from: string, to: string) { return this.spendBy(from, to, "centre"); }

  /** Twelve months ending this month, oldest first, zeros included. */
  async monthly(today = todayIST()) {
    const start = addMonths(monthStart(today), -11), got = new Map((await this.spendBy(start, today, "month")).map((m) => [m.key, m.paise]));
    return Array.from({ length: 12 }, (_, i) => { const m = addMonths(start, i).slice(0, 7); return { month: m, paise: got.get(m) ?? 0 }; });
  }

  /** Vendors by what approved bills in the period came to, before tax withheld. */
  async topVendors(from: string, to: string, limit = 10) {
    return this.read("read", async (tx) => (await tx.select({ id: expVendors.id, name: expVendors.name, v: sql<string>`sum(${expBills.grossPaise})` }).from(expBills).innerJoin(expVendors, eq(expVendors.id, expBills.vendorId))
      .where(and(eq(expBills.status, "approved"), sql`${expBills.billDate} between ${from} and ${to}`)).groupBy(expVendors.id, expVendors.name).orderBy(desc(sql`sum(${expBills.grossPaise})`)).limit(limit)).map((r) => ({ ...r, paise: Number(r.v) })));
  }

  /** Approved bills still owing that fall due within the next `days` (and anything already late), soonest first. */
  async upcoming(days = 30, today = todayIST()) {
    return this.read("read", async (tx) => (await tx.select({ b: expBills, vendorName: expVendors.name }).from(expBills).innerJoin(expVendors, eq(expVendors.id, expBills.vendorId))
      .where(and(eq(expBills.status, "approved"), sql`${expBills.paidPaise} < ${expBills.grossPaise} - ${expBills.tdsPaise}`, sql`${expBills.dueDate} <= ${addDays(today, days)}`)).orderBy(expBills.dueDate).limit(50))
      .map(({ b, vendorName }) => ({ id: b.id, billNo: b.billNo, vendorId: b.vendorId, vendorName, dueDate: b.dueDate, openPaise: openOf(b), netPaise: netOf(b), state: billState(b, today) })));
  }

  /** Everything the dashboard shows, in one call. */
  async dashboard(today = todayIST()) {
    const fy = fyOf(today), [from, to] = fyRange(fy), month = monthStart(today), monthIdx = (+today.slice(5, 7) + 8) % 12;
    const [monthly, ageing, upcoming, byAccount, grid, calendar] = await Promise.all([
      this.monthly(today), this.ageing(today), this.upcoming(30, today), this.byAccount(from, to),
      new BudgetService(this.ctx).grid(fy), new RecurringService(this.ctx).calendar(2),
    ]);
    const spent = monthly.at(-1)!.paise, last = monthly.at(-2)?.paise ?? 0;
    const budgetMonth = grid.reduce((s, b) => s + (b.months[monthIdx] ?? 0), 0);
    const watch = grid.filter((b) => b.totalPaise > 0).map((b) => ({ id: b.id, label: b.centreName ? `${b.accountName} (${b.centreName})` : b.accountName, actualPaise: b.actualPaise + b.committedPaise, budgetPaise: b.totalPaise }))
      .filter((b) => b.actualPaise / b.budgetPaise >= 0.6).sort((a, b) => b.actualPaise / b.budgetPaise - a.actualPaise / a.budgetPaise).slice(0, 6);
    return { fy, month, spentPaise: spent, lastMonthPaise: last, budgetMonthPaise: budgetMonth, monthly, ageing, upcoming, byAccount: byAccount.slice(0, 8), watch, calendar, hasBudgets: grid.length > 0 };
  }
}
