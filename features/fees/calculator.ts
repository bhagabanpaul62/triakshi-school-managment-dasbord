// The arithmetic of fees. Pure: no database, no React, no clock (callers pass "today"), so the server,
// the seed and the record-payment dialog all compute exactly the same numbers. Money is integer paise.

export interface CalcItem { headId: string; amountPaise: number }
export interface CalcInstallment { id: string; name: string; dueDate: string; amountPaise: number }
/** value: paise for "amount", basis points (1000 = 10%) for "percent". headId null = the whole fee. */
export interface CalcConcession { headId: string | null; kind: "amount" | "percent"; value: number }
export interface CalcLateRule { installmentId: string | null; kind: "flat" | "per_day"; amountPaise: number; graceDays: number; maxPaise: number | null }
export interface CalcPayment {
  id: string;
  paidOn: string;
  status: "valid" | "cancelled";
  allocations: { installmentId: string; amountPaise: number; lateFeePaise: number }[];
}
export interface CalcInput {
  items: CalcItem[];
  installments: CalcInstallment[];
  concessions: CalcConcession[];
  lateRules: CalcLateRule[];
  payments: CalcPayment[];
  /** "YYYY-MM-DD" */
  today: string;
}

export type LineStatus = "paid" | "partial" | "pending" | "overdue";

export interface StatementLine {
  installmentId: string;
  name: string;
  dueDate: string;
  gross: number;
  concession: number;
  /** gross - concession */
  net: number;
  lateFee: number;
  principalPaid: number;
  latePaid: number;
  paid: number;
  principalDue: number;
  lateDue: number;
  /** principalDue + lateDue, never below zero */
  due: number;
  overdue: boolean;
  status: LineStatus;
}

export interface Statement {
  lines: StatementLine[];
  totals: { gross: number; concession: number; net: number; late: number; paid: number; due: number; overdue: number; credit: number };
}

export interface Allocation { installmentId: string; name: string; amountPaise: number; lateFeePaise: number }
export interface AllocationPlan { allocations: Allocation[]; allocated: number; principal: number; lateFee: number; unallocated: number }

const DAY = 86_400_000;
const utc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

/** "₹18,000" or "₹18,000.50" from paise. */
export const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: p % 100 ? 2 : 0 })}`;

/**
 * Rules, in one place:
 *  - Concessions: head-specific ones first (capped at that head), then whole-fee ones (capped at what is left of the fee).
 *    A percent is taken of its base and rounded to whole paise. The total is spread over the installments in proportion
 *    to their amounts, to the paisa (largest remainder).
 *  - Late fee: days late = days after the due date minus grace days. "flat" charges the amount once, "per_day" charges
 *    it for every late day, both capped by maxPaise. It stops growing on the day the installment's principal is cleared.
 *  - Allocation of a payment: oldest installment first; inside an installment the late fee is paid before the principal.
 *  - Cancelled payments are ignored everywhere.
 *  - Reconciliation: gross - concession + late - paid = due - credit (credit is only non-zero when a concession is
 *    added after money was already paid).
 */
export class FeeCalculator {
  constructor(private readonly input: CalcInput) {}

  /** Split `total` over `weights` in proportion, in whole units, so the parts add up exactly. */
  static apportion(total: number, weights: number[]): number[] {
    const sum = weights.reduce((a, b) => a + b, 0);
    if (!weights.length) return [];
    if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
    const parts = weights.map((w) => Math.floor((total * w) / sum));
    const order = weights
      .map((w, i) => ({ i, rem: (total * w) % sum }))
      .sort((a, b) => b.rem - a.rem || a.i - b.i);
    const remainder = total - parts.reduce((a, b) => a + b, 0); // fixed before the loop: incrementing parts must not shrink the bound
    for (let k = 0; k < remainder; k++) parts[order[k % order.length]!.i]!++;
    return parts;
  }

  static daysBetween(from: string, to: string): number {
    return Math.round((utc(to) - utc(from)) / DAY);
  }

  /** Percent (basis points) of a base, rounded to whole paise. */
  static percentOf(base: number, basisPoints: number): number {
    return Math.round((base * basisPoints) / 10_000);
  }

  get grossTotal(): number {
    return this.input.installments.reduce((s, i) => s + i.amountPaise, 0);
  }

  /** Total concession, after capping. */
  concessionTotal(): number {
    const { items, concessions } = this.input;
    const gross = this.grossTotal;
    const left = new Map(items.map((i) => [i.headId, i.amountPaise]));
    const raw = (c: CalcConcession, base: number) => Math.min(base, c.kind === "percent" ? FeeCalculator.percentOf(base, c.value) : c.value);
    let total = 0;
    for (const c of concessions.filter((x) => x.headId)) {
      const base = left.get(c.headId!) ?? 0;
      const amount = raw(c, base);
      left.set(c.headId!, base - amount);
      total += amount;
    }
    for (const c of concessions.filter((x) => !x.headId)) {
      const base = gross - total;
      total += Math.min(base, c.kind === "percent" ? FeeCalculator.percentOf(gross, c.value) : c.value);
    }
    return Math.min(total, gross);
  }

  /** Late fee of one installment if its principal were still open until `until`. */
  lateFeeFor(inst: CalcInstallment, until: string): number {
    const { lateRules } = this.input;
    const rule = lateRules.find((r) => r.installmentId === inst.id) ?? lateRules.find((r) => r.installmentId === null);
    if (!rule) return 0;
    const days = Math.max(0, FeeCalculator.daysBetween(inst.dueDate, until) - rule.graceDays);
    if (days === 0) return 0;
    const fee = rule.kind === "flat" ? rule.amountPaise : rule.amountPaise * days;
    return rule.maxPaise == null ? fee : Math.min(fee, rule.maxPaise);
  }

  statement(): Statement {
    const { installments, payments, today } = this.input;
    const sorted = [...installments].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const concessions = FeeCalculator.apportion(this.concessionTotal(), sorted.map((i) => i.amountPaise));
    const valid = payments.filter((p) => p.status === "valid").sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.id.localeCompare(b.id));

    const lines = sorted.map((inst, k): StatementLine => {
      const net = inst.amountPaise - concessions[k]!;
      let principalPaid = 0, latePaid = 0, clearedOn: string | null = null;
      for (const p of valid) {
        for (const a of p.allocations) {
          if (a.installmentId !== inst.id) continue;
          principalPaid += a.amountPaise;
          latePaid += a.lateFeePaise;
          if (clearedOn === null && principalPaid >= net) clearedOn = p.paidOn;
        }
      }
      // Late fee stops growing the day the principal is cleared; nothing is late on a fully conceded installment.
      const lateFee = net <= 0 ? 0 : this.lateFeeFor(inst, clearedOn ?? today);
      const late = Math.max(lateFee, latePaid);
      const principalDue = Math.max(0, net - principalPaid);
      const lateDue = late - latePaid;
      const due = principalDue + lateDue;
      const overdue = due > 0 && inst.dueDate < today;
      const paid = principalPaid + latePaid;
      const status: LineStatus = due === 0 ? "paid" : overdue ? "overdue" : paid > 0 ? "partial" : "pending";
      return { installmentId: inst.id, name: inst.name, dueDate: inst.dueDate, gross: inst.amountPaise, concession: concessions[k]!, net, lateFee: late, principalPaid, latePaid, paid, principalDue, lateDue, due, overdue, status };
    });

    const sum = (f: (l: StatementLine) => number) => lines.reduce((s, l) => s + f(l), 0);
    const credit = sum((l) => Math.max(0, l.principalPaid + l.latePaid - l.net - l.lateFee));
    return {
      lines,
      totals: {
        gross: sum((l) => l.gross), concession: sum((l) => l.concession), net: sum((l) => l.net), late: sum((l) => l.lateFee),
        paid: sum((l) => l.paid), due: sum((l) => l.due), overdue: sum((l) => (l.overdue ? l.due : 0)), credit,
      },
    };
  }

  /** The first installment that still has something to pay. */
  nextDue(): StatementLine | undefined {
    return this.statement().lines.find((l) => l.due > 0);
  }

  /** How a payment of `amountPaise` made on `paidOn` would be spread. `unallocated` > 0 means it is more than is owed. */
  allocate(amountPaise: number, paidOn: string): AllocationPlan {
    const { lines } = new FeeCalculator({ ...this.input, today: paidOn }).statement();
    let left = amountPaise;
    const allocations: Allocation[] = [];
    for (const l of lines) {
      const late = Math.min(left, l.lateDue);
      left -= late;
      const principal = Math.min(left, l.principalDue);
      left -= principal;
      if (late + principal > 0) allocations.push({ installmentId: l.installmentId, name: l.name, amountPaise: principal, lateFeePaise: late });
    }
    const lateFee = allocations.reduce((s, a) => s + a.lateFeePaise, 0);
    const principal = allocations.reduce((s, a) => s + a.amountPaise, 0);
    return { allocations, allocated: principal + lateFee, principal, lateFee, unallocated: left };
  }
}
