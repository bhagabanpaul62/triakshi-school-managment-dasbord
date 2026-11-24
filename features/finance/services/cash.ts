import { z } from "zod";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { uuidv7, type Tx } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { rupees, todayIST } from "@smw/feature-kit/money";
import { balanceOf } from "../posting";
import { CASH_KINDS, finAccounts, finCashAccounts, finJournalLines, finJournals } from "../schema";
import { FinanceService, day, paiseAmount } from "./common";

export type CashAccount = typeof finCashAccounts.$inferSelect;
/** `openingSet`: an opening balance was posted and not undone. */
export type CashAccountWithBalance = CashAccount & { balancePaise: number; openingSet: boolean };

/** name@handle, as UPI IDs are written. */
const upiId = z.string().trim().regex(/^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,30}$/, "A UPI ID looks like school@bank.");
const text = (max: number) => z.string().trim().max(max).optional();
const details = {
  name: z.string().trim().min(2, "Give it a name.").max(60),
  bankName: text(60),
  accountLast4: z.string().trim().regex(/^\d{4}$/, "Only the last 4 digits.").optional(),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "An IFSC is 4 letters, a zero, then 6 characters.").optional(),
  upiId: upiId.optional(),
  upiName: text(60),
};
const createInput = z.object({ ...details, kind: z.enum(CASH_KINDS), isDefault: z.preprocess((v) => v === true || v === "true", z.boolean()) });
const updateInput = z.object(details);
const transferInput = z.object({ fromId: z.uuid(), toId: z.uuid(), amountPaise: paiseAmount, date: day.optional(), memo: z.string().trim().max(200).optional() });
const openingInput = z.object({ accountId: z.uuid(), amountPaise: z.coerce.number().int().refine((n) => n !== 0, "Enter an amount, not zero."), date: day });

/** Balance of every cash and bank account, one aggregate. Shared with the dashboard. */
export async function cashBalances(tx: Tx): Promise<Map<string, number>> {
  const rows = await tx.select({ id: finCashAccounts.id, net: sql<string>`coalesce(sum(${finJournalLines.debitPaise} - ${finJournalLines.creditPaise}), 0)` })
    .from(finCashAccounts).leftJoin(finJournalLines, eq(finJournalLines.accountId, finCashAccounts.accountId)).groupBy(finCashAccounts.id);
  return new Map(rows.map((r) => [r.id, Number(r.net)]));
}

/** Where money physically is. Every cash or bank account has its own ledger account under "Cash and bank". */
export class CashAccountService extends FinanceService {
  async list(): Promise<CashAccountWithBalance[]> {
    return this.read("read", async (tx) => {
      const [rows, bal, openings] = await Promise.all([
        tx.select().from(finCashAccounts).orderBy(asc(finCashAccounts.kind), asc(finCashAccounts.createdAt)), cashBalances(tx),
        // An opening entry counts once, its undo takes it away again.
        tx.select({ id: finJournals.sourceId, live: sql<number>`sum(case when ${finJournals.kind} = 'opening' then 1 else -1 end)::int` }).from(finJournals).where(eq(finJournals.sourceType, "opening")).groupBy(finJournals.sourceId),
      ]);
      return rows.map((r) => ({ ...r, balancePaise: bal.get(r.id) ?? 0, openingSet: (openings.find((o) => o.id === r.id)?.live ?? 0) > 0 }));
    });
  }

  async create(input: unknown): Promise<CashAccount> {
    this.authorize("settings", "write");
    const d = this.parse(createInput, input);
    return this.write("settings", async (tx) => {
      // The ledger account takes the first free code in the cash block (1040 to 1099).
      const used = new Set((await tx.select({ c: finAccounts.code }).from(finAccounts)).map((r) => r.c));
      const code = Array.from({ length: 60 }, (_, i) => String(1040 + i)).find((c) => !used.has(c));
      if (!code) throw new ConflictError("There is no room for another cash or bank account.");
      const [ledger] = await tx.insert(finAccounts).values({ schoolId: this.ctx.schoolId, code, name: d.name, type: "asset", group: "Cash and bank" }).returning({ id: finAccounts.id });
      const [haveDefault] = await tx.select({ id: finCashAccounts.id }).from(finCashAccounts).where(and(eq(finCashAccounts.kind, d.kind), eq(finCashAccounts.isDefault, true), eq(finCashAccounts.isActive, true))).limit(1);
      const makeDefault = d.isDefault || !haveDefault;
      if (makeDefault) await tx.update(finCashAccounts).set({ isDefault: false }).where(eq(finCashAccounts.kind, d.kind));
      const [row] = await tx.insert(finCashAccounts).values({ ...d, schoolId: this.ctx.schoolId, accountId: ledger!.id, isDefault: makeDefault }).returning();
      return row!;
    }, (r) => ({ action: "create", entity: "Cash account", entityId: r.id, summary: `Added ${r.kind} account ${r.name}` }));
  }

  async update(id: string, input: unknown): Promise<CashAccount> {
    this.authorize("settings", "write");
    const d = this.parse(updateInput, input);
    return this.write("settings", async (tx) => {
      const [row] = await tx.update(finCashAccounts).set({ ...d, bankName: d.bankName ?? null, accountLast4: d.accountLast4 ?? null, ifsc: d.ifsc ?? null, upiId: d.upiId ?? null, upiName: d.upiName ?? null }).where(eq(finCashAccounts.id, id)).returning();
      if (!row) throw new NotFoundError("Cash account");
      await tx.update(finAccounts).set({ name: d.name }).where(eq(finAccounts.id, row.accountId));
      return row;
    }, (r) => ({ action: "update", entity: "Cash account", entityId: r.id, summary: `Updated ${r.kind} account ${r.name}` }));
  }

  /** The account money goes to when nobody picks one. One per kind. */
  async setDefault(id: string): Promise<CashAccount> {
    return this.write("settings", async (tx) => {
      const [row] = await tx.select().from(finCashAccounts).where(eq(finCashAccounts.id, id)).for("update");
      if (!row) throw new NotFoundError("Cash account");
      if (!row.isActive) throw new ConflictError("Switch it on first.");
      await tx.update(finCashAccounts).set({ isDefault: false }).where(eq(finCashAccounts.kind, row.kind));
      const [r] = await tx.update(finCashAccounts).set({ isDefault: true }).where(eq(finCashAccounts.id, id)).returning();
      return r!;
    }, (r) => ({ action: "default", entity: "Cash account", entityId: r.id, summary: `${r.name} is now the default ${r.kind} account` }));
  }

  /** Switch off only when empty and not the last one of its kind. */
  async setActive(id: string, active: boolean): Promise<CashAccount> {
    return this.write("settings", async (tx) => {
      const [row] = await tx.select().from(finCashAccounts).where(eq(finCashAccounts.id, id)).for("update");
      if (!row) throw new NotFoundError("Cash account");
      if (!active) {
        if (await balanceOf(tx, [row.accountId])) throw new ConflictError("It still holds money. Use Banking, Move money, to transfer it to another account so the balance is zero, then switch it off.");
        const others = await tx.select({ id: finCashAccounts.id }).from(finCashAccounts).where(and(eq(finCashAccounts.kind, row.kind), eq(finCashAccounts.isActive, true), sql`${finCashAccounts.id} <> ${id}`)).limit(1);
        if (!others.length) throw new ConflictError(`This is the only ${row.kind} account in use. Add another one in Finance setup, Cash accounts and UPI, first.`);
      }
      const [r] = await tx.update(finCashAccounts).set({ isActive: active, ...(active ? {} : { isDefault: false }) }).where(eq(finCashAccounts.id, id)).returning();
      await tx.update(finAccounts).set({ isActive: active }).where(eq(finAccounts.id, row.accountId));
      if (!active && row.isDefault) {
        const [next] = await tx.select({ id: finCashAccounts.id }).from(finCashAccounts).where(and(eq(finCashAccounts.kind, row.kind), eq(finCashAccounts.isActive, true))).orderBy(asc(finCashAccounts.createdAt)).limit(1);
        if (next) await tx.update(finCashAccounts).set({ isDefault: true }).where(eq(finCashAccounts.id, next.id));
      }
      return r!;
    }, (r) => ({ action: r.isActive ? "enable" : "disable", entity: "Cash account", entityId: r.id, summary: `${r.isActive ? "Switched on" : "Switched off"} ${r.kind} account ${r.name}` }));
  }

  /** Move money between two of the school's own accounts. Posts once; both accounts are locked so two transfers cannot overspend. */
  async transfer(input: unknown) {
    this.authorize("journal", "write");
    const d = this.parse(transferInput, input);
    if (d.fromId === d.toId) throw new ValidationError({ toId: "Choose two different accounts." });
    return this.write("journal", async (tx) => {
      const date = await this.moneyDate(tx, d.date);
      const rows = await tx.select().from(finCashAccounts).where(inArray(finCashAccounts.id, [d.fromId, d.toId])).orderBy(asc(finCashAccounts.id)).for("update");
      const from = rows.find((r) => r.id === d.fromId), to = rows.find((r) => r.id === d.toId);
      if (!from || !to || !from.isActive || !to.isActive) throw new ConflictError("Choose two accounts that are in use.");
      const have = await balanceOf(tx, [from.accountId]);
      if (have < d.amountPaise) throw new ConflictError(`${from.name} holds only ${rupees(have)}.`);
      const posted = await this.post(tx, {
        date, sourceKey: `finance:transfer:${uuidv7()}`, sourceType: "transfer", kind: "transfer", memo: d.memo || `Transfer from ${from.name} to ${to.name}`,
        lines: [{ account: { id: to.accountId }, debit: d.amountPaise }, { account: { id: from.accountId }, credit: d.amountPaise }],
      });
      return { journalId: posted!.id, from: from.name, to: to.name, amountPaise: d.amountPaise, date };
    }, (r) => ({ action: "transfer", entity: "Journal", entityId: r.journalId, summary: `Moved ${rupees(r.amountPaise)} from ${r.from} to ${r.to}`, meta: { amountPaise: r.amountPaise } }));
  }

  /** What the account held when the books started. Once; a wrong one is reversed first (Journals), then set again. Negative = overdrawn. */
  async setOpening(input: unknown) {
    this.authorize("journal", "write");
    // Money from nowhere with no second person, so only an admin may set it.
    if (this.ctx.role !== "admin") throw new ForbiddenError("An admin sets opening balances. Ask yours to set this one.");
    const d = this.parse(openingInput, input);
    return this.write("journal", async (tx) => {
      if (d.date > todayIST()) throw new ValidationError({ date: "The date cannot be in the future." });
      const [acc] = await tx.select().from(finCashAccounts).where(eq(finCashAccounts.id, d.accountId)).for("update");
      if (!acc) throw new NotFoundError("Cash account");
      const prior = await tx.select({ id: finJournals.id }).from(finJournals).where(and(eq(finJournals.sourceType, "opening"), eq(finJournals.sourceId, acc.id), eq(finJournals.kind, "opening")));
      const reversed = prior.length ? await tx.select({ id: finJournals.id }).from(finJournals).where(inArray(finJournals.reversesId, prior.map((p) => p.id))) : [];
      if (prior.length > reversed.length) throw new ConflictError(`The opening balance of ${acc.name} is already set. Reverse it in Journals if it is wrong.`);
      const abs = Math.abs(d.amountPaise), money = { account: { id: acc.accountId } }, equity = { account: "opening" as const };
      const posted = await this.post(tx, {
        date: d.date, sourceKey: `finance:opening:${acc.id}:${prior.length + 1}`, sourceType: "opening", sourceId: acc.id, kind: "opening", memo: `Opening balance of ${acc.name}`,
        lines: d.amountPaise > 0 ? [{ ...money, debit: abs }, { ...equity, credit: abs }] : [{ ...equity, debit: abs }, { ...money, credit: abs }],
      });
      return { journalId: posted!.id, account: acc.name, amountPaise: d.amountPaise };
    }, (r) => ({ action: "opening", entity: "Journal", entityId: r.journalId, summary: `Opening balance of ${r.account}: ${rupees(r.amountPaise)}`, meta: { amountPaise: r.amountPaise } }));
  }

}
