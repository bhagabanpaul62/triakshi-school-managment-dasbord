import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { NotFoundError, ValidationError } from "@smw/feature-kit";
import { apportion, fyOf, fyRange, rupees, todayIST } from "@smw/feature-kit/money";
import { parseSheet, SheetError } from "@smw/integrations";
import type { Tx } from "@smw/db";
import { finAccounts, finCostCentres, finJournalLines, finJournals } from "@smw/feature-finance/schema";
import { loadFinanceSettings } from "@smw/feature-finance/settings";
import { BUDGET_ALERTS } from "./constants";
import { ExpenseService, checkAccount, checkCentre, managers, tell } from "./base";
import type { UploadedFile } from "./files";
import { optionalId, paiseAmount } from "./inputs";
import { expBillLines, expBudgetAlerts, expBudgets, expBills } from "./schema";

export type Budget = typeof expBudgets.$inferSelect;
const MONTHS = ["apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec", "jan", "feb", "mar"];
const monthIndex = (m: number) => (m >= 4 ? m - 4 : m + 8);
const fyLabel = z.string().regex(/^\d{4}-\d{2}$/, "Use a year like 2026-27.");

/** What a budget has used: ledger actuals by month, and what is promised but not yet in the ledger (bills waiting, and on the cash basis the unpaid part of approved bills). */
async function usage(tx: Tx, b: Budget, basis: "accrual" | "cash", excludeBillId?: string) {
  const [from, to] = fyRange(b.fy);
  const rows = await tx.select({ m: sql<number>`extract(month from ${finJournals.date})::int`, v: sql<string>`sum(${finJournalLines.debitPaise} - ${finJournalLines.creditPaise})` })
    .from(finJournalLines).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId))
    .where(and(eq(finJournalLines.accountId, b.accountId), b.costCentreId ? eq(finJournalLines.costCentreId, b.costCentreId) : undefined, sql`${finJournals.date} between ${from} and ${to}`))
    .groupBy(sql`extract(month from ${finJournals.date})`);
  const months = Array<number>(12).fill(0);
  for (const r of rows) months[monthIndex(r.m)] = Number(r.v);
  const net = sql`(${expBills.grossPaise} - ${expBills.tdsPaise})`;
  const [c] = await tx.select({ v: sql<string>`coalesce(sum(case when ${expBills.status} = 'pending' then ${expBillLines.amountPaise} else ${expBillLines.amountPaise} * (${net} - ${expBills.paidPaise}) / ${net} end), 0)` })
    .from(expBillLines).innerJoin(expBills, eq(expBills.id, expBillLines.billId))
    .where(and(eq(expBillLines.accountId, b.accountId), b.costCentreId ? eq(expBillLines.costCentreId, b.costCentreId) : undefined, sql`${expBills.billDate} between ${from} and ${to}`,
      excludeBillId ? sql`${expBills.id} <> ${excludeBillId}` : undefined, basis === "cash" ? inArray(expBills.status, ["pending", "approved"]) : eq(expBills.status, "pending")));
  return { months, actualPaise: months.reduce((a, b2) => a + b2, 0), committedPaise: Math.round(Number(c?.v ?? 0)) };
}
const total = (b: Pick<Budget, "months">) => b.months.reduce((a, c) => a + c, 0);

/**
 * Would these lines cross a budget? `warnings` always let it through; `blocks` (budgets set to block) send the bill to an approver.
 * A line uses the budget of its own cost centre, else the account's budget without a cost centre.
 */
export async function budgetCheck(tx: Tx, i: { date: string; lines: { accountId: string; costCentreId: string | null; amountPaise: number }[]; excludeBillId?: string }) {
  const fy = fyOf(i.date), basis = (await loadFinanceSettings(tx)).basis;
  const budgets = await tx.select().from(expBudgets).where(eq(expBudgets.fy, fy));
  const names = new Map((await tx.select({ id: finAccounts.id, name: finAccounts.name }).from(finAccounts)).map((a) => [a.id, a.name]));
  const asked = new Map<string, { b: Budget; add: number }>();
  for (const l of i.lines) {
    const b = budgets.find((x) => x.accountId === l.accountId && l.costCentreId && x.costCentreId === l.costCentreId) ?? budgets.find((x) => x.accountId === l.accountId && !x.costCentreId);
    if (b) asked.set(b.id, { b, add: (asked.get(b.id)?.add ?? 0) + l.amountPaise });
  }
  const out = { warnings: [] as string[], blocks: [] as string[] };
  for (const { b, add } of asked.values()) {
    const u = await usage(tx, b, basis, i.excludeBillId), after = u.actualPaise + u.committedPaise + add, cap = total(b);
    if (after <= cap) continue;
    const msg = `${names.get(b.accountId)} budget for ${b.fy} is ${rupees(cap)}. With this it would be ${rupees(after)}.`;
    (b.onOver === "block" ? out.blocks : out.warnings).push(b.onOver === "block" ? `Over budget: ${msg}` : msg);
  }
  return out;
}

/** Tell the managers once when a budget passes 80% and again at 100%. Run by the nightly job. */
export async function sendBudgetAlerts(tx: Tx, schoolId: string) {
  const fy = fyOf(todayIST()), basis = (await loadFinanceSettings(tx)).basis;
  const budgets = await tx.select().from(expBudgets).where(eq(expBudgets.fy, fy));
  const names = new Map((await tx.select({ id: finAccounts.id, name: finAccounts.name }).from(finAccounts)).map((a) => [a.id, a.name]));
  const who = await managers(tx);
  let sent = 0;
  for (const b of budgets) {
    const cap = total(b);
    if (!cap) continue;
    const u = await usage(tx, b, basis), pct = ((u.actualPaise + u.committedPaise) / cap) * 100;
    for (const level of BUDGET_ALERTS.filter((x) => pct >= x)) {
      const [made] = await tx.insert(expBudgetAlerts).values({ schoolId, budgetId: b.id, percent: level }).onConflictDoNothing().returning();
      if (!made) continue;
      sent++;
      await tell(tx, schoolId, who, "work.update", level >= 100 ? "Budget used up" : "Budget nearly used", `${names.get(b.accountId)}: ${Math.floor(pct)}% of ${rupees(cap)} is spent or promised.`, "/app/expenses/budgets", { subject: { type: "budget", id: b.id }, groupKey: `budget:${b.id}` });
    }
  }
  return sent;
}

const saveInput = z.object({
  fy: fyLabel, accountId: z.uuid("Choose an account."), costCentreId: optionalId,
  months: z.preprocess((v) => (typeof v === "string" ? JSON.parse(v) : v), z.array(z.coerce.number().int().min(0)).length(12, "A budget has 12 months.").optional()),
  /** Or one figure for the year, spread evenly. */
  yearlyPaise: paiseAmount.optional(),
  onOver: z.enum(["warn", "block"]).default("warn"),
}).refine((v) => v.months || v.yearlyPaise, { path: ["yearlyPaise"], message: "Enter the year's amount or each month." });

export class BudgetService extends ExpenseService {
  async grid(fy = fyOf(todayIST())) {
    this.parse(fyLabel, fy);
    return this.read("read", async (tx) => {
      const basis = (await loadFinanceSettings(tx)).basis;
      const rows = await tx.select({ b: expBudgets, accountName: finAccounts.name, accountCode: finAccounts.code, centreName: finCostCentres.name }).from(expBudgets)
        .innerJoin(finAccounts, eq(finAccounts.id, expBudgets.accountId)).leftJoin(finCostCentres, eq(finCostCentres.id, expBudgets.costCentreId)).where(eq(expBudgets.fy, fy)).orderBy(finAccounts.code);
      const out = [];
      for (const { b, accountName, accountCode, centreName } of rows) {
        const u = await usage(tx, b, basis), cap = total(b);
        out.push({ ...b, accountName, accountCode, centreName, totalPaise: cap, actualMonths: u.months, actualPaise: u.actualPaise, committedPaise: u.committedPaise, leftPaise: cap - u.actualPaise - u.committedPaise });
      }
      return out;
    });
  }

  /** Set or replace one budget line. */
  async save(input: unknown) {
    const d = this.parse(saveInput, input);
    const months = d.months ?? apportion(d.yearlyPaise!, Array(12).fill(1));
    return this.write("manage", async (tx) => {
      await checkAccount(tx, d.accountId, "expense"); await checkCentre(tx, d.costCentreId);
      const [have] = await tx.select().from(expBudgets).where(and(eq(expBudgets.fy, d.fy), eq(expBudgets.accountId, d.accountId), d.costCentreId ? eq(expBudgets.costCentreId, d.costCentreId) : sql`${expBudgets.costCentreId} is null`)).for("update");
      if (have) return (await tx.update(expBudgets).set({ months, onOver: d.onOver }).where(eq(expBudgets.id, have.id)).returning())[0]!;
      return (await tx.insert(expBudgets).values({ schoolId: this.ctx.schoolId, fy: d.fy, accountId: d.accountId, costCentreId: d.costCentreId ?? null, months, onOver: d.onOver }).returning())[0]!;
    }, (r) => ({ action: "save", entity: "Budget", entityId: r.id, summary: `Set budget ${r.fy} to ${rupees(total(r))}` }));
  }

  async remove(id: string) {
    return this.write("manage", async (tx) => {
      const [r] = await tx.delete(expBudgets).where(eq(expBudgets.id, id)).returning();
      if (!r) throw new NotFoundError("Budget");
      return r;
    }, (r) => ({ action: "delete", entity: "Budget", entityId: r.id, summary: `Removed budget ${r.fy}` }));
  }

  /** Make next year's budget from last year's actual spend, per account, month by month. Budgets that exist are left alone. */
  async copyActuals(fy: string) {
    this.parse(fyLabel, fy);
    const prev = `${+fy.slice(0, 4) - 1}-${String(+fy.slice(2, 4)).padStart(2, "0")}`;
    return this.write("manage", async (tx) => {
      const [from, to] = fyRange(prev);
      const rows = await tx.select({ id: finJournalLines.accountId, m: sql<number>`extract(month from ${finJournals.date})::int`, v: sql<string>`sum(${finJournalLines.debitPaise} - ${finJournalLines.creditPaise})` })
        .from(finJournalLines).innerJoin(finJournals, eq(finJournals.id, finJournalLines.journalId)).innerJoin(finAccounts, eq(finAccounts.id, finJournalLines.accountId))
        .where(and(eq(finAccounts.type, "expense"), sql`${finJournals.date} between ${from} and ${to}`)).groupBy(finJournalLines.accountId, sql`extract(month from ${finJournals.date})`);
      const by = new Map<string, number[]>();
      for (const r of rows) { const a = by.get(r.id) ?? Array<number>(12).fill(0); a[monthIndex(r.m)] = Math.max(0, Number(r.v)); by.set(r.id, a); }
      const have = new Set((await tx.select({ a: expBudgets.accountId }).from(expBudgets).where(and(eq(expBudgets.fy, fy), sql`${expBudgets.costCentreId} is null`))).map((x) => x.a));
      const fresh = [...by].filter(([id, m]) => !have.has(id) && m.some((x) => x > 0));
      if (fresh.length) await tx.insert(expBudgets).values(fresh.map(([accountId, months]) => ({ schoolId: this.ctx.schoolId, fy, accountId, months })));
      return { created: fresh.length, from: prev };
    }, (r) => ({ action: "copy", entity: "Budget", summary: `Copied ${r.created} budget(s) from ${r.from} spending` }));
  }

  /** Budgets from a sheet: account_code, optional cost_centre (name), then apr..mar, or one `year` column. Any bad row stops the whole file. */
  async importSheet(fy: string, file: UploadedFile) {
    this.parse(fyLabel, fy);
    this.authorize("manage", "write");
    let sheet;
    try { sheet = await parseSheet(file); } catch (e) { if (e instanceof SheetError) throw new ValidationError({ file: e.message }); throw e; }
    return this.write("manage", async (tx) => {
      const accounts = new Map((await tx.select({ id: finAccounts.id, code: finAccounts.code, type: finAccounts.type }).from(finAccounts)).map((a) => [a.code, a]));
      const centres = new Map((await tx.select({ id: finCostCentres.id, name: finCostCentres.name }).from(finCostCentres)).map((c) => [c.name.toLowerCase(), c.id]));
      const errors: string[] = [], made: { accountId: string; costCentreId: string | null; months: number[] }[] = [];
      sheet.rows.forEach((r, i) => {
        const line = `Row ${sheet.lines[i]}`, acc = accounts.get(r.account_code ?? "");
        if (!acc || acc.type !== "expense") return void errors.push(`${line}: account code ${r.account_code || "(blank)"} is not an expense account.`);
        const cc = r.cost_centre ? centres.get(r.cost_centre.toLowerCase()) : null;
        if (r.cost_centre && !cc) return void errors.push(`${line}: cost centre ${r.cost_centre} does not exist.`);
        const cells = MONTHS.map((m) => r[m] ?? ""), rupeesOf = (s: string) => Math.round(Number(s.replace(/,/g, "")) * 100);
        const months = r.year ? apportion(rupeesOf(r.year), Array(12).fill(1)) : cells.map((c) => (c === "" ? 0 : rupeesOf(c)));
        if (months.some((x) => !Number.isFinite(x) || x < 0) || months.every((x) => x === 0)) return void errors.push(`${line}: give the amounts in rupees, as a year or for each month.`);
        made.push({ accountId: acc.id, costCentreId: cc ?? null, months });
      });
      if (errors.length) throw new ValidationError({ file: errors.slice(0, 8).join(" ") }, `${errors.length} row(s) need fixing. Nothing was saved.`);
      if (!made.length) throw new ValidationError({ file: "The sheet has no rows." });
      for (const m of made) {
        const [have] = await tx.select({ id: expBudgets.id }).from(expBudgets).where(and(eq(expBudgets.fy, fy), eq(expBudgets.accountId, m.accountId), m.costCentreId ? eq(expBudgets.costCentreId, m.costCentreId) : sql`${expBudgets.costCentreId} is null`));
        if (have) await tx.update(expBudgets).set({ months: m.months }).where(eq(expBudgets.id, have.id));
        else await tx.insert(expBudgets).values({ schoolId: this.ctx.schoolId, fy, ...m });
      }
      return { imported: made.length };
    }, (r) => ({ action: "import", entity: "Budget", summary: `Imported ${r.imported} budget line(s) for ${fy}` }));
  }
}
