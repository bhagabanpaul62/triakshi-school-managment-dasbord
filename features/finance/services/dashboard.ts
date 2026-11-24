import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { addMonths, monthStart, todayIST } from "@smw/feature-kit/money";
import { systemAccounts } from "../chart";
import { finApprovals, finCashAccounts, finJournalLines, finJournals } from "../schema";
import { CashAccountService, cashBalances } from "./cash";
import { dashboardExtras } from "./dashboard-extras";
import { FinanceService } from "./common";
import { runControlChecks, type ControlCheck, type Mismatch } from "./control";
import { JournalService, type JournalRow } from "./journals";

export interface FinanceOverview {
  cash: { id: string; name: string; kind: "cash" | "bank"; accountId: string; balancePaise: number }[];
  cashTotalPaise: number;
  monthInPaise: number;
  monthOutPaise: number;
  /** Last 12 months, oldest first. */
  trend: { month: string; inPaise: number; outPaise: number }[];
  pendingApprovals: number;
  recent: JournalRow[];
  mismatches: Mismatch[];
  /** What is owed to the school and by it, from the system accounts. Positive = the usual direction. */
  owed: { studentDuesPaise: number; studentAdvancesPaise: number; depositsPaise: number; vendorDuesPaise: number; salaryPayablePaise: number };
  extras: DashboardExtras;
}

export interface SetupStep { key: string; text: string; done: boolean; href: string; /** Who can fix it: finance settings, fee setup, or the counter. */ needs: "settings" | "fees-setup" | "fees-collect" | "reconcile" }
export interface DashboardExtras {
  fy: string; from: string; to: string; basis: "accrual" | "cash";
  /** Financial year to date, from the fee income, concession and student dues accounts. */
  fees: { billedPaise: number; concessionsPaise: number; collectedPaise: number; duePaise: number; links: { billed: string; concessions: string; collected: string; due: string } };
  /** Spend against the budget so far; null when budgets are not in use. */
  budget: { rows: { accountId: string; name: string; budgetPaise: number; actualPaise: number; href: string }[]; yearBudgetPaise: number; toDateBudgetPaise: number; toDateActualPaise: number; href: string } | null;
  /** Open bills by how late they are; null when fees are not in use. */
  ageing: { buckets: { label: string; paise: number; href: string }[]; totalPaise: number } | null;
  salary: { salaryPaise: number; incomePaise: number; shareBp: number | null; href: string };
  perStudent: { students: number; expensePaise: number; perStudentPaise: number; href: string } | null;
  forecast: { openingPaise: number; months: { label: string; inPaise: number; outPaise: number; closingPaise: number }[]; notes: string[] };
  setup: SetupStep[];
  unmatchedBankLines: number;
}

export class FinanceDashboardService extends FinanceService {
  /** First version of the home screen. Every number is a SQL aggregate, so it stays fast with years of entries. */
  async overview(extraChecks: ControlCheck[] = []): Promise<FinanceOverview> {
    const [recent, cashList] = await Promise.all([new JournalService(this.ctx).list({ pageSize: 8 }), new CashAccountService(this.ctx).list()]);
    return this.read("read", async (tx) => {
      const thisMonth = monthStart(todayIST()), first = addMonths(thisMonth, -11);
      const system = await systemAccounts(tx, this.ctx.schoolId);
      const owedKeys = ["student_dues", "student_advances", "deposits_payable", "vendor_dues", "salary_payable"] as const;
      const cashLedger = tx.select({ id: finCashAccounts.accountId }).from(finCashAccounts);
      const month = sql<string>`to_char(${finJournals.date}, 'YYYY-MM-01')`;
      const [accounts, balances, flow, owed, [pending], mismatches] = await Promise.all([
        tx.select().from(finCashAccounts).orderBy(finCashAccounts.kind, finCashAccounts.createdAt), cashBalances(tx),
        // Transfers and opening balances move money without earning or spending it, so they are not "in" or "out".
        tx.select({ m: month, debit: sql<string>`coalesce(sum(${finJournalLines.debitPaise}), 0)`, credit: sql<string>`coalesce(sum(${finJournalLines.creditPaise}), 0)` })
          .from(finJournalLines).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId))
          .where(and(inArray(finJournalLines.accountId, cashLedger), notInArray(finJournals.sourceType, ["transfer", "opening"]), sql`${finJournals.date} >= ${first}`)).groupBy(month),
        tx.select({ id: finJournalLines.accountId, net: sql<string>`coalesce(sum(${finJournalLines.debitPaise} - ${finJournalLines.creditPaise}), 0)` })
          .from(finJournalLines).where(inArray(finJournalLines.accountId, owedKeys.map((k) => system[k]))).groupBy(finJournalLines.accountId),
        tx.select({ n: sql<number>`count(*)::int` }).from(finApprovals).where(eq(finApprovals.status, "pending")),
        runControlChecks(tx, this.ctx.schoolId, extraChecks),
      ]);
      const cash = accounts.filter((a) => a.isActive).map((a) => ({ id: a.id, name: a.name, kind: a.kind, accountId: a.accountId, balancePaise: balances.get(a.id) ?? 0 }));
      const trend = Array.from({ length: 12 }, (_, i) => {
        const m = addMonths(first, i), f = flow.find((r) => r.m === m);
        return { month: m, inPaise: Number(f?.debit ?? 0), outPaise: Number(f?.credit ?? 0) };
      });
      const net = (key: (typeof owedKeys)[number]) => Number(owed.find((o) => o.id === system[key])?.net ?? 0);
      const cashTotalPaise = cash.reduce((s, c) => s + c.balancePaise, 0);
      const extras = await dashboardExtras(tx, {
        system, cashTotalPaise, duesPaise: net("student_dues"), hasCash: cash.some((c) => c.kind === "cash"), hasBank: cash.some((c) => c.kind === "bank"),
        hasUpi: cash.some((c) => accounts.find((x) => x.id === c.id)?.upiId), openingSet: cashList.filter((c) => c.isActive).every((c) => c.openingSet),
      });
      return {
        cash, cashTotalPaise,
        monthInPaise: trend[11]!.inPaise, monthOutPaise: trend[11]!.outPaise, trend,
        pendingApprovals: Number(pending?.n ?? 0), recent: recent.rows, mismatches,
        owed: { studentDuesPaise: net("student_dues"), studentAdvancesPaise: -net("student_advances"), depositsPaise: -net("deposits_payable"), vendorDuesPaise: -net("vendor_dues"), salaryPayablePaise: -net("salary_payable") }, extras,
      };
    });
  }
}
