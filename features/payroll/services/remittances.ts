import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, ValidationError } from "@smw/feature-kit";
import { addMonths, monthEnd, todayIST } from "@smw/feature-kit/money";
import { cashAccount } from "@smw/feature-finance/posting";
import { day, paiseAmount } from "@smw/feature-finance/services/common";
import { PayrollService } from "../base";
import { finAccounts } from "@smw/feature-finance/schema";
import { accountOfKey, remitKeyOf } from "../ledger";
import { payComponents, payItems, payLines, payRemittances, payRuns } from "../schema";

export const REMIT_KEYS = ["pf", "esi", "pt", "tds", "lwf"] as const;
export type RemitKey = (typeof REMIT_KEYS)[number];
export const REMIT_LABEL: Record<string, string> = { pf: "Provident fund", esi: "ESI", pt: "Professional tax", tds: "Income tax (TDS)", lwf: "Labour welfare fund", other: "Other salary deductions held" };

export interface Remittance { key: string; label: string; month: string; duePaise: number; paidPaise: number; outstandingPaise: number; dueDate: string; late: boolean }
const input = z.object({ key: z.string().refine((k) => k in REMIT_LABEL || /^acct:[0-9a-f-]{36}$/.test(k), "Unknown payment."), month: z.string().regex(/^\d{4}-\d{2}-01$/), amountPaise: paiseAmount, paidOn: day.optional(), reference: z.string().trim().max(80).optional(), cashAccountId: z.uuid().optional() });

/** What the school owes the PF, ESI, tax and other offices, month by month, worked out from approved runs; and the payments made. */
export class RemittanceService extends PayrollService {
  /** Months with something owed, newest first. `onlyOpen` keeps those not fully paid. */
  async list(o: { onlyOpen?: boolean } = {}): Promise<Remittance[]> {
    return this.read("read", async (tx) => {
      const book = await this.rateBook(tx);
      const owed = await tx.select({ month: payRuns.month, code: payLines.code, ref: payLines.refId, v: sql<string>`sum(${payLines.amountPaise})` }).from(payLines).innerJoin(payItems, eq(payItems.id, payLines.itemId)).innerJoin(payRuns, eq(payRuns.id, payItems.runId))
        .where(and(inArray(payRuns.status, ["approved", "paid"]), sql`${payItems.skippedReason} is null`, inArray(payLines.kind, ["deduction", "employer"]))).groupBy(payRuns.month, payLines.code, payLines.refId);
      const refs = [...new Set(owed.filter((o) => o.code === null && o.ref).map((o) => o.ref!))];
      const held = new Map((refs.length ? await tx.select({ id: payComponents.id, accountId: payComponents.accountId }).from(payComponents).where(inArray(payComponents.id, refs)) : []).map((c) => [c.id, c.accountId]));
      const topUps = await tx.select({ month: payRuns.month, v: sql<string>`sum(coalesce((${payRuns.totals}->>'pfAdminTopUp')::bigint, 0))` }).from(payRuns).where(inArray(payRuns.status, ["approved", "paid"])).groupBy(payRuns.month);
      const paid = await tx.select({ key: payRemittances.key, month: payRemittances.month, v: sql<string>`sum(${payRemittances.amountPaise})` }).from(payRemittances).groupBy(payRemittances.key, payRemittances.month);
      const due = new Map<string, number>();
      const add = (k: string, m: string, v: number) => due.set(`${k}|${m}`, (due.get(`${k}|${m}`) ?? 0) + v);
      for (const r of owed) { const k = remitKeyOf({ code: r.code }, r.code === null && r.ref ? held.get(r.ref) ?? null : null); if (k) add(k, r.month, Number(r.v)); }
      for (const t of topUps) if (Number(t.v)) add("pf", t.month, Number(t.v));
      const names = new Map((await tx.select({ id: finAccounts.id, name: finAccounts.name }).from(finAccounts)).map((x) => [x.id, x.name]));
      const labelOf = (key: string) => (key.startsWith("acct:") ? `${names.get(key.slice(5)) ?? "Held account"} (held from salaries)` : REMIT_LABEL[key]!);
      const today = todayIST();
      const out: Remittance[] = [...due].filter(([, v]) => v > 0).map(([id, duePaise]) => {
        const [key, month] = id.split("|") as [string, string];
        const paidPaise = Number(paid.find((p) => p.key === key && p.month === month)?.v ?? 0), dueDate = (REMIT_KEYS as readonly string[]).includes(key) ? book.dueDate(key as RemitKey, month) : monthEnd(addMonths(month, 1));
        return { key, label: labelOf(key), month, duePaise, paidPaise, outstandingPaise: duePaise - paidPaise, dueDate, late: duePaise > paidPaise && dueDate < today };
      }).sort((a, b) => b.month.localeCompare(a.month) || a.key.localeCompare(b.key));
      return o.onlyOpen ? out.filter((r) => r.outstandingPaise > 0) : out;
    });
  }

  payments() { return this.read("read", (tx) => tx.select().from(payRemittances).orderBy(sql`${payRemittances.paidOn} desc`)); }

  /** Record a payment to an office; it clears the payable. Never more than what is still owed for that month. */
  async record(raw: unknown) {
    this.authorize("manage", "write");
    const d = this.parse(input, raw);
    return this.write("manage", async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${this.ctx.schoolId}:remit:${d.key}:${d.month}`}, 0))`);
      const row = (await this.list()).find((r) => r.key === d.key && r.month === d.month);
      if (!row) throw new ConflictError("Nothing is owed for that month.");
      if (d.amountPaise > row.outstandingPaise) throw new ValidationError({ amountPaise: `Only ${row.outstandingPaise / 100} rupees are still owed for this month.` });
      const date = await this.moneyDate(tx, d.paidOn, "paidOn");
      const acc = await cashAccount(tx, this.ctx.schoolId, { id: d.cashAccountId, kind: "bank" });
      const target = accountOfKey(d.key);
      if (typeof target === "object" && !(await tx.select({ id: finAccounts.id }).from(finAccounts).where(eq(finAccounts.id, target.id))).length) throw new ConflictError("That account does not exist any more.");
      const [r] = await tx.insert(payRemittances).values({ schoolId: this.ctx.schoolId, key: d.key, month: d.month, amountPaise: d.amountPaise, paidOn: date, reference: d.reference ?? null, cashAccountId: acc.id, createdBy: this.ctx.userId }).returning();
      await this.post(tx, { date, sourceKey: `payroll:remit:${r!.id}`, sourceType: "payroll_remittance", sourceId: r!.id, memo: `${row.label} paid for ${d.month.slice(0, 7)}`, lines: [{ account: target, debit: d.amountPaise }, { account: { id: acc.accountId }, credit: d.amountPaise }] });
      return r!;
    }, (r) => ({ action: "remit", entity: "PayRemittance", entityId: r.id, summary: `Paid ${REMIT_LABEL[r.key] ?? "held amount"} for ${r.month.slice(0, 7)}`, meta: { amountPaise: r.amountPaise } }));
  }

  /** The next payments that are due, soonest first (for the dashboard and the reminder job). */
  async upcoming(limit = 5): Promise<Remittance[]> { return (await this.list({ onlyOpen: true })).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, limit); }
}
