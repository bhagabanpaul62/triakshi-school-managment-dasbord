import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, ValidationError } from "@smw/feature-kit";
import { todayIST } from "@smw/feature-kit/money";
import { cashAccount } from "@smw/feature-finance/posting";
import { day, paiseAmount } from "@smw/feature-finance/services/common";
import { PayrollService } from "../base";
import { payItems, payLines, payRemittances, payRuns } from "../schema";

export const REMIT_KEYS = ["pf", "esi", "pt", "tds", "lwf"] as const;
export type RemitKey = (typeof REMIT_KEYS)[number];
export const REMIT_LABEL: Record<RemitKey, string> = { pf: "Provident fund", esi: "ESI", pt: "Professional tax", tds: "Income tax (TDS)", lwf: "Labour welfare fund" };
const ACCOUNT = { pf: "pf_payable", esi: "esi_payable", pt: "pt_payable", tds: "tds_payable", lwf: "lwf_payable" } as const;
const keyOf = (code: string): RemitKey | null => (["pf_employee", "pf_employer", "eps_employer", "edli", "pf_admin"].includes(code) ? "pf" : code.startsWith("esi") ? "esi" : code === "pt" ? "pt" : code === "tds" ? "tds" : code.startsWith("lwf") ? "lwf" : null);

export interface Remittance { key: RemitKey; month: string; duePaise: number; paidPaise: number; outstandingPaise: number; dueDate: string; late: boolean }
const input = z.object({ key: z.enum(REMIT_KEYS), month: z.string().regex(/^\d{4}-\d{2}-01$/), amountPaise: paiseAmount, paidOn: day.optional(), reference: z.string().trim().max(80).optional(), cashAccountId: z.uuid().optional() });

/** What the school owes the PF, ESI, tax and other offices, month by month, worked out from approved runs; and the payments made. */
export class RemittanceService extends PayrollService {
  /** Months with something owed, newest first. `onlyOpen` keeps those not fully paid. */
  async list(o: { onlyOpen?: boolean } = {}): Promise<Remittance[]> {
    return this.read("read", async (tx) => {
      const book = await this.rateBook(tx);
      const owed = await tx.select({ month: payRuns.month, code: payLines.code, v: sql<string>`sum(${payLines.amountPaise})` }).from(payLines).innerJoin(payItems, eq(payItems.id, payLines.itemId)).innerJoin(payRuns, eq(payRuns.id, payItems.runId))
        .where(and(inArray(payRuns.status, ["approved", "paid"]), sql`${payItems.skippedReason} is null`, sql`${payLines.code} is not null`)).groupBy(payRuns.month, payLines.code);
      const topUps = await tx.select({ month: payRuns.month, v: sql<string>`sum(coalesce((${payRuns.totals}->>'pfAdminTopUp')::bigint, 0))` }).from(payRuns).where(inArray(payRuns.status, ["approved", "paid"])).groupBy(payRuns.month);
      const paid = await tx.select({ key: payRemittances.key, month: payRemittances.month, v: sql<string>`sum(${payRemittances.amountPaise})` }).from(payRemittances).groupBy(payRemittances.key, payRemittances.month);
      const due = new Map<string, number>();
      const add = (k: string, m: string, v: number) => due.set(`${k}|${m}`, (due.get(`${k}|${m}`) ?? 0) + v);
      for (const r of owed) { const k = keyOf(r.code!); if (k) add(k, r.month, Number(r.v)); }
      for (const t of topUps) if (Number(t.v)) add("pf", t.month, Number(t.v));
      const today = todayIST();
      const out: Remittance[] = [...due].filter(([, v]) => v > 0).map(([id, duePaise]) => {
        const [key, month] = id.split("|") as [RemitKey, string];
        const paidPaise = Number(paid.find((p) => p.key === key && p.month === month)?.v ?? 0), dueDate = book.dueDate(key, month);
        return { key, month, duePaise, paidPaise, outstandingPaise: duePaise - paidPaise, dueDate, late: duePaise > paidPaise && dueDate < today };
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
      const [r] = await tx.insert(payRemittances).values({ schoolId: this.ctx.schoolId, key: d.key, month: d.month, amountPaise: d.amountPaise, paidOn: date, reference: d.reference ?? null, cashAccountId: acc.id, createdBy: this.ctx.userId }).returning();
      await this.post(tx, { date, sourceKey: `payroll:remit:${r!.id}`, sourceType: "payroll_remittance", sourceId: r!.id, memo: `${REMIT_LABEL[d.key]} paid for ${d.month.slice(0, 7)}`, lines: [{ account: ACCOUNT[d.key], debit: d.amountPaise }, { account: { id: acc.accountId }, credit: d.amountPaise }] });
      return r!;
    }, (r) => ({ action: "remit", entity: "PayRemittance", entityId: r.id, summary: `Paid ${REMIT_LABEL[r.key as RemitKey]} for ${r.month.slice(0, 7)}`, meta: { amountPaise: r.amountPaise } }));
  }

  /** The next payments that are due, soonest first (for the dashboard and the reminder job). */
  async upcoming(limit = 5): Promise<Remittance[]> { return (await this.list({ onlyOpen: true })).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, limit); }
}
