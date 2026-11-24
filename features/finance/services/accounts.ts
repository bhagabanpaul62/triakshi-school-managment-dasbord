import { z } from "zod";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { CrudService, ConflictError, NotFoundError, listQuerySchema, toPage, type Page } from "@smw/feature-kit";
import { addDays } from "@smw/feature-kit/money";
import type { Tx } from "@smw/db";
import financeFeature from "../feature";
import { ACCOUNT_TYPES, finAccounts, finCashAccounts, finCostCentres, finJournalLines, finJournals } from "../schema";
import { balanceOf } from "../posting";
import { day, type FinancePermission } from "./common";

const accountFields = {
  code: z.string().trim().regex(/^\d{3,6}$/, "Use 3 to 6 digits, like 5400."),
  name: z.string().trim().min(2, "Give the account a name.").max(80),
  type: z.enum(ACCOUNT_TYPES),
  group: z.string().trim().min(2).max(40),
};
export type Account = typeof finAccounts.$inferSelect;
/** Debit minus credit; `shown` is the same number in the sign people expect (income and liabilities read positive when credited). */
export type AccountWithBalance = Account & { balancePaise: number; shownPaise: number };

export interface LedgerQuery { from?: string; to?: string; page?: number; pageSize?: number }
export interface LedgerRow { lineId: string; journalId: string; number: string; date: string; kind: string; memo: string; debitPaise: number; creditPaise: number; runningPaise: number }

/** The chart of accounts. System accounts can be renamed, never deleted, retyped or switched off. */
export class AccountService extends CrudService<typeof finAccounts, FinancePermission> {
  protected readonly feature = financeFeature;
  protected readonly table = finAccounts;
  protected readonly entityName = "Account";
  protected readonly readPermission = "read";
  protected readonly writePermission = "journal";
  protected readonly createSchema = z.object(accountFields);
  protected readonly updateSchema = z.object(accountFields).partial();
  protected searchColumns() { return [finAccounts.name, finAccounts.code]; }
  protected sortColumns() { return { createdAt: finAccounts.createdAt, code: finAccounts.code, name: finAccounts.name }; }
  protected filterClauses(f: Record<string, string | undefined>) {
    return [f.type ? eq(finAccounts.type, f.type as Account["type"]) : undefined, f.active ? eq(finAccounts.isActive, f.active === "1") : undefined];
  }

  private async lineCount(tx: Tx, id: string) {
    return Number((await tx.select({ n: sql<number>`count(*)::int` }).from(finJournalLines).where(eq(finJournalLines.accountId, id)))[0]?.n ?? 0);
  }
  private async assertFreeCode(tx: Tx, code: string, except?: string) {
    const [dup] = await tx.select({ id: finAccounts.id }).from(finAccounts).where(eq(finAccounts.code, code)).limit(1);
    if (dup && dup.id !== except) throw new ConflictError(`Code ${code} is already used by another account.`);
  }

  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) {
    await this.assertFreeCode(tx, String(data.code));
    return data;
  }
  protected async beforeUpdate(tx: Tx, existing: Account, data: Record<string, unknown>) {
    if (existing.systemKey) {
      if ((data.code && data.code !== existing.code) || (data.type && data.type !== existing.type)) throw new ConflictError("The product posts to this account, so only its name can change.");
      return { name: data.name, group: data.group };
    }
    if (data.code && data.code !== existing.code) await this.assertFreeCode(tx, String(data.code), existing.id);
    if (data.type && data.type !== existing.type && (await this.lineCount(tx, existing.id)) > 0) throw new ConflictError("This account already has entries, so its type cannot change.");
    return data;
  }
  protected async beforeRemove(_tx: Tx, existing: Account) {
    if (existing.systemKey) throw new ConflictError("The product posts to this account, so it cannot be deleted.");
  }
  protected async usage(tx: Tx, existing: Account): Promise<[string, number][]> {
    const [cash] = await tx.select({ n: sql<number>`count(*)::int` }).from(finCashAccounts).where(eq(finCashAccounts.accountId, existing.id));
    return [["entries", await this.lineCount(tx, existing.id)], ["cash or bank accounts", Number(cash?.n ?? 0)]];
  }

  /** Switch an own account off (it leaves the pickers; its history stays) or back on. */
  async setActive(id: string, active: boolean): Promise<Account> {
    return this.write("journal", async (tx) => {
      const row = await this.findOrThrow(tx, id);
      if (!active && row.systemKey) throw new ConflictError("The product posts to this account, so it cannot be switched off.");
      const [cash] = await tx.select({ id: finCashAccounts.id }).from(finCashAccounts).where(eq(finCashAccounts.accountId, id)).limit(1);
      if (!active && cash) throw new ConflictError("This belongs to a cash or bank account. Switch that one off instead.");
      const [r] = await tx.update(finAccounts).set({ isActive: active }).where(eq(finAccounts.id, id)).returning();
      return r!;
    }, (r) => ({ action: r.isActive ? "enable" : "disable", entity: "Account", entityId: r.id, summary: `${r.isActive ? "Switched on" : "Switched off"} account ${r.code} ${r.name}` }));
  }

  /** Every account with its balance, in code order, for the chart screen. One aggregate. */
  async withBalances(): Promise<AccountWithBalance[]> {
    return this.read("read", async (tx) => {
      const rows = await tx.select({ account: finAccounts, net: sql<string>`coalesce(sum(${finJournalLines.debitPaise} - ${finJournalLines.creditPaise}), 0)` })
        .from(finAccounts).leftJoin(finJournalLines, eq(finJournalLines.accountId, finAccounts.id)).groupBy(finAccounts.id).orderBy(asc(finAccounts.code));
      return rows.map(({ account, net }) => {
        const balancePaise = Number(net);
        return { ...account, balancePaise, shownPaise: account.type === "asset" || account.type === "expense" ? balancePaise : -balancePaise };
      });
    });
  }

  /** One account's lines with a running balance, oldest first, paged. The opening balance is everything before `from`. */
  async ledger(accountId: string, query: LedgerQuery = {}): Promise<{ account: Account; openingPaise: number; closingPaise: number; rows: Page<LedgerRow> }> {
    const q = listQuerySchema.parse({ page: query.page, pageSize: query.pageSize ?? 50 });
    const from = query.from ? day.parse(query.from) : undefined, to = query.to ? day.parse(query.to) : undefined;
    return this.read("read", async (tx) => {
      const account = await this.findOrThrow(tx, accountId);
      const openingPaise = from ? await balanceOf(tx, [accountId], { upTo: addDays(from, -1) }) : 0;
      const where = and(eq(finJournalLines.accountId, accountId), from ? gte(finJournals.date, from) : undefined, to ? lte(finJournals.date, to) : undefined);
      const order = [asc(finJournals.date), asc(finJournals.createdAt), asc(finJournalLines.id)];
      const [rows, [tot]] = await Promise.all([
        tx.select({
          lineId: finJournalLines.id, journalId: finJournals.id, number: finJournals.number, date: finJournals.date, kind: finJournals.kind,
          memo: sql<string>`coalesce(${finJournalLines.memo}, ${finJournals.memo})`, debitPaise: finJournalLines.debitPaise, creditPaise: finJournalLines.creditPaise,
          running: sql<string>`sum(${finJournalLines.debitPaise} - ${finJournalLines.creditPaise}) over (order by ${finJournals.date}, ${finJournals.createdAt}, ${finJournalLines.id})`,
        }).from(finJournalLines).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId)).where(where).orderBy(...order).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int`, net: sql<string>`coalesce(sum(${finJournalLines.debitPaise} - ${finJournalLines.creditPaise}), 0)` })
          .from(finJournalLines).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId)).where(where),
      ]);
      return {
        account, openingPaise, closingPaise: openingPaise + Number(tot?.net ?? 0),
        rows: toPage(rows.map(({ running, ...r }) => ({ ...r, runningPaise: openingPaise + Number(running) })), Number(tot?.n ?? 0), q),
      };
    });
  }
}

export type CostCentre = typeof finCostCentres.$inferSelect;
export class CostCentreService extends CrudService<typeof finCostCentres, FinancePermission> {
  protected readonly feature = financeFeature;
  protected readonly table = finCostCentres;
  protected readonly entityName = "Cost centre";
  protected readonly readPermission = "read";
  protected readonly writePermission = "settings";
  private static readonly fields = z.object({ name: z.string().trim().min(2, "Give it a name.").max(60) });
  protected readonly createSchema = CostCentreService.fields;
  protected readonly updateSchema = CostCentreService.fields;
  protected searchColumns() { return [finCostCentres.name]; }
  protected async usage(tx: Tx, existing: CostCentre): Promise<[string, number][]> {
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(finJournalLines).where(eq(finJournalLines.costCentreId, existing.id));
    return [["entries", Number(r?.n ?? 0)]];
  }
  async setActive(id: string, active: boolean) {
    return this.write("settings", async (tx) => {
      const [r] = await tx.update(finCostCentres).set({ isActive: active }).where(eq(finCostCentres.id, id)).returning();
      if (!r) throw new NotFoundError("Cost centre");
      return r;
    }, (r) => ({ action: r.isActive ? "enable" : "disable", entity: "Cost centre", entityId: r.id, summary: `${r.isActive ? "Switched on" : "Switched off"} cost centre ${r.name}` }));
  }
}
