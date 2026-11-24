// Pure rules of the money-taking screens: no React, no database. The counter screen and the tests read the same functions.
import { rupees } from "@smw/feature-kit/money";
import { allocatePlan, dueNow, type CalcInvoice, type CalcLine, type DeskBill } from "../../calc";

export { dueNow, type DeskBill };

export interface Chosen { id: string; /** Pay only this much on the bill; leave out to pay it all. */ limitPaise?: number | null }

/** The bill the way `allocatePlan` wants it. The late fee is added as the last line, exactly as collect() fixes it. */
export function asCalc(b: DeskBill, limit?: number | null): CalcInvoice {
  const lines: CalcLine[] = [...b.lines];
  if (b.accruedLatePaise > 0) {
    lines.push({ id: `late:${b.id}`, kind: "late", amountPaise: b.accruedLatePaise, concessionPaise: 0, creditedPaise: 0, paidPaise: 0, sort: lines.reduce((m, l) => Math.max(m, l.sort), 0) + 1 });
  }
  return { id: b.id, dueDate: b.dueDate, parts: b.parts, lines, limit: limit ?? undefined };
}

export interface PreviewRow { billId: string; billLabel: string; line: string; amountPaise: number }
export interface Preview {
  rows: PreviewRow[];
  /** What lands on each bill. */
  perBill: Record<string, number>;
  appliedPaise: number;
  /** Money above what the chosen bills need: becomes an advance. */
  leftoverPaise: number;
}

/** Exactly which lines of which bills a payment will clear, by the same function the server uses. */
export function previewAllocation(bills: DeskBill[], picks: Chosen[], amountPaise: number, lateFirst: boolean): Preview {
  const chosen = picks.flatMap((p) => { const b = bills.find((x) => x.id === p.id); return b ? [{ b, limit: p.limitPaise }] : []; });
  const plan = allocatePlan(chosen.map((c) => asCalc(c.b, c.limit)), Math.max(0, amountPaise), { lateFirst });
  const names = new Map(chosen.flatMap(({ b }) => [...b.lines.map((l) => [l.id, l.label] as const), [`late:${b.id}`, "Late fee"] as const]));
  const labels = new Map(chosen.map(({ b }) => [b.id, b.label]));
  const rows = plan.parts.map((p) => ({ billId: p.invoiceId, billLabel: labels.get(p.invoiceId) ?? "", line: names.get(p.lineId) ?? "", amountPaise: p.amountPaise }));
  const perBill: Record<string, number> = {};
  for (const r of rows) perBill[r.billId] = (perBill[r.billId] ?? 0) + r.amountPaise;
  return { rows, perBill, appliedPaise: amountPaise - plan.leftover, leftoverPaise: plan.leftover };
}

/** What the chosen bills come to today, each capped at its own limit. */
export function pickedTotal(bills: DeskBill[], picks: Chosen[]): number {
  return picks.reduce((s, p) => { const b = bills.find((x) => x.id === p.id); return b ? s + Math.min(dueNow(b), p.limitPaise ?? Infinity) : s; }, 0);
}

export type SelectMode = "all" | "overdue" | "oldest" | "none";

/** The ids a quick button selects. Oldest = the bill that fell due first. */
export function selectIds(bills: DeskBill[], mode: SelectMode): string[] {
  const byDate = [...bills].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  if (mode === "all") return byDate.map((b) => b.id);
  if (mode === "overdue") return byDate.filter((b) => b.state === "overdue").map((b) => b.id);
  if (mode === "oldest") return byDate.slice(0, 1).map((b) => b.id);
  return [];
}

/** Cash tendered against cash due: what to hand back, or what is still short. */
export function changeDue(cashPaise: number, tenderedPaise: number | null): { changePaise: number; shortPaise: number } {
  if (tenderedPaise == null) return { changePaise: 0, shortPaise: 0 };
  return { changePaise: Math.max(0, tenderedPaise - cashPaise), shortPaise: Math.max(0, cashPaise - tenderedPaise) };
}

/** Notes and coins, largest first. Keys are paise, as the counter service wants them. */
export const DENOMINATIONS: { paise: number; label: string }[] = [200000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100].map((p) => ({ paise: p, label: `₹${p / 100}` }));

/** What a count of notes and coins comes to. */
export function denominationTotal(counts: Record<string, number>): number {
  return Object.entries(counts).reduce((s, [paise, n]) => s + Number(paise) * Math.max(0, Math.trunc(n || 0)), 0);
}

/** Only the denominations that were counted (the service stores what it is given). */
export const nonZero = (counts: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));

export interface MethodPart { method: string; amountPaise: number }

/** Why this split cannot be collected yet, in plain words; null when it can. Mirrors the checks collect() makes. */
export function splitProblem(parts: MethodPart[], totalPaise: number, advanceHeldPaise: number, leftoverPaise: number): string | null {
  if (totalPaise <= 0) return "Choose a bill or enter an amount.";
  const sum = parts.reduce((s, p) => s + p.amountPaise, 0);
  if (sum !== totalPaise) return sum < totalPaise ? `${rupees(totalPaise - sum)} is not assigned to a method yet.` : `The methods add up to ${rupees(sum - totalPaise)} too much.`;
  if (parts.some((p) => p.method === "cheque") && parts.length > 1) return "Take a cheque in its own receipt.";
  const adv = parts.find((p) => p.method === "advance")?.amountPaise ?? 0;
  if (adv > advanceHeldPaise) return `The advance is only ${rupees(advanceHeldPaise)}.`;
  if (adv > 0 && leftoverPaise > totalPaise - adv) return "The advance is more than what is due. Use less of it.";
  return null;
}

export interface Outcome {
  receiptPaise: number;
  /** Still owed on the chosen bills after this payment. */
  leftDuePaise: number;
  newAdvancePaise: number;
  latePaise: number;
  /** One plain sentence per posting. */
  lines: string[];
}

/** The "what will happen" box: totals and the postings in words, before anything is saved. */
export function outcomeOf(o: { totalPaise: number; leftoverPaise: number; picked: DeskBill[]; appliedPaise: number; parts: MethodPart[]; payer: string }): Outcome {
  const owed = o.picked.reduce((s, b) => s + dueNow(b), 0);
  const late = o.picked.reduce((s, b) => s + b.accruedLatePaise, 0);
  const label = (m: string) => ({ cash: "The cash box", upi: "The bank account (UPI)", card: "The bank account (card)", bank_transfer: "The bank account", cheque: "Cheques in hand", advance: "The advance balance" })[m] ?? m;
  const lines = [
    ...o.parts.map((p) => `${label(p.method)} ${p.method === "advance" ? "goes down" : "goes up"} by ${rupees(p.amountPaise)}.`),
    ...(o.appliedPaise > 0 ? [`${o.payer}'s family owes ${rupees(o.appliedPaise)} less.`] : []),
    ...(late > 0 ? [`Late fee of ${rupees(late)} is added to the bills first.`] : []),
    ...(o.leftoverPaise > 0 ? [`${rupees(o.leftoverPaise)} is kept as advance for the next bill.`] : []),
  ];
  return { receiptPaise: o.totalPaise, leftDuePaise: Math.max(0, owed - o.appliedPaise), newAdvancePaise: o.leftoverPaise, latePaise: late, lines };
}

/** A warning before collect(), so the cashier can ask for UPI or a cheque. The server warns again with the day's total. */
export function cashLimitWarning(cashPaise: number, limitPaise: number): string | null {
  return limitPaise > 0 && cashPaise >= limitPaise ? `${rupees(cashPaise)} in cash reaches the school's warning limit of ${rupees(limitPaise)} a day. Ask for UPI or a cheque if you can.` : null;
}

/** Text a cashier can send to the family. No link is included unless one is given. */
export function shareText(r: { number: string; amountPaise: number; student: string; school: string; link?: string }): string {
  return `Fee receipt ${r.number} for ${rupees(r.amountPaise)} received for ${r.student}. Thank you. ${r.school}${r.link ? `\n${r.link}` : ""}`;
}

/** The earliest day money may be dated. */
export const earliestDate = (today: string, backdateDays: number) => new Date(Date.parse(`${today}T00:00:00Z`) - backdateDays * 86_400_000).toISOString().slice(0, 10);

/** One CSV cell that a spreadsheet will not run as a formula: a leading = + - @ tab or return gets an apostrophe. */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
