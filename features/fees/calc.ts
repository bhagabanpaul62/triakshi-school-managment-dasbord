// The arithmetic of fees. Pure: no database, no React, no clock (callers pass "today"), so the server, the seed and the
// screens compute the same numbers. Money is integer paise.
import { apportion, daysBetween, percentOf } from "@smw/feature-kit/money";
import type { DueState, LateRule } from "./constants";

export interface Part { dueOn: string; amountPaise: number }
export interface CalcLine { id: string; kind: string; amountPaise: number; concessionPaise: number; creditedPaise: number; paidPaise: number; sort: number }
/** A bill as the arithmetic sees it. `limit` caps what one payment may put on it. */
export interface CalcInvoice { id: string; dueDate: string; parts?: Part[]; lines: CalcLine[]; limit?: number }
/** The cached totals of an invoice row (see FeesBase.refreshInvoiceTotals). */
export interface Totals { grossPaise: number; concessionPaise: number; creditedPaise: number; latePaise: number; paidPaise: number }
export interface Conc { headId: string | null; mode: "percent" | "amount"; value: number }

/** What is still open on a line or on an invoice's totals. */
export function openOf(x: CalcLine | Totals): number {
  return "amountPaise" in x
    ? x.amountPaise - x.concessionPaise - x.creditedPaise - x.paidPaise
    : x.grossPaise - x.concessionPaise - x.creditedPaise + x.latePaise - x.paidPaise;
}
const invoiceOpen = (inv: CalcInvoice) => inv.lines.reduce((s, l) => s + openOf(l), 0);

/**
 * What is open, by the day it falls due. Without parts it is one slice on the due date. With parts (a settlement), money
 * paid so far clears the earliest parts first; anything above the parts falls due on the invoice's own date.
 */
export function slicesOf(inv: { dueDate: string; parts?: Part[] }, open: number): { dueOn: string; openPaise: number }[] {
  if (open <= 0) return [];
  const parts = [...(inv.parts ?? [])].sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  if (!parts.length) return [{ dueOn: inv.dueDate, openPaise: open }];
  const total = parts.reduce((s, p) => s + p.amountPaise, 0);
  let covered = Math.max(0, total - open);
  const out: { dueOn: string; openPaise: number }[] = [];
  for (const p of parts) {
    const take = Math.min(covered, p.amountPaise);
    covered -= take;
    if (p.amountPaise - take > 0) out.push({ dueOn: p.dueOn, openPaise: p.amountPaise - take });
  }
  if (open > total) out.push({ dueOn: inv.dueDate, openPaise: open - total });
  return out;
}

/**
 * The late fee that has built up and is not yet a bill line. `openPaise` is what is open, `fixedPaise` what earlier
 * payments already turned into late lines (the cap counts both). Per-day and slab fees are not a function of the open
 * amount, so they stop only when nothing is open.
 */
export function lateFee(rule: LateRule | null | undefined, a: { dueOn: string; until: string; openPaise: number; fixedPaise: number }): number {
  if (!rule || a.openPaise <= 0) return 0;
  const late = daysBetween(a.dueOn, a.until) - rule.graceDays;
  if (late <= 0) return 0;
  let total = 0;
  if (rule.kind === "flat") total = rule.amountPaise ?? 0;
  else if (rule.kind === "per_day") total = (rule.amountPaise ?? 0) * late;
  else if (rule.kind === "percent") total = percentOf(a.openPaise, rule.basisPoints ?? 0);
  else total = [...(rule.slabs ?? [])].sort((x, y) => x.afterDays - y.afterDays).filter((s) => s.afterDays <= late).pop()?.amountPaise ?? 0;
  if (rule.maxPaise != null) total = Math.min(total, rule.maxPaise);
  return Math.max(0, total - a.fixedPaise);
}

/** Late fee of a whole invoice as of `until`: its open principal (late lines are not charged late fee) by slice. */
export function invoiceLateFee(rule: LateRule | null | undefined, inv: CalcInvoice, until: string): number {
  if (!rule) return 0;
  const principal = inv.lines.filter((l) => l.kind !== "late").reduce((s, l) => s + openOf(l), 0);
  const fixed = inv.lines.filter((l) => l.kind === "late").reduce((s, l) => s + l.amountPaise, 0);
  let left = principal, total = 0;
  // Each slice carries its own fee; the cap is on the invoice, so slices are taken uncapped and the cap is applied once.
  const uncapped = { ...rule, maxPaise: null };
  for (const s of slicesOf(inv, invoiceOpen(inv))) {
    const base = Math.min(s.openPaise, left);
    left -= base;
    total += lateFee(uncapped, { dueOn: s.dueOn, until, openPaise: base, fixedPaise: 0 });
  }
  if (rule.maxPaise != null) total = Math.min(total, rule.maxPaise);
  return Math.max(0, total - fixed);
}

/** The state a person sees, worked out from the totals and dates; never stored. */
export function dueState(inv: Totals & { status: string; dueDate: string; parts?: Part[] }, today: string): DueState {
  if (inv.status === "cancelled") return "cancelled";
  if (inv.status === "draft") return "draft";
  const open = openOf(inv);
  if (open <= 0) return "paid";
  const next = slicesOf(inv, open)[0]!.dueOn;
  if (next < today) return "overdue";
  if (inv.paidPaise > 0) return "part_paid";
  return daysBetween(today, next) <= 7 ? "due" : "upcoming";
}

/**
 * Spread `amount` over what is open, earliest due date first across ALL bills (a settlement part of one bill and the
 * part of another that fall due the same day are cleared together). Inside a bill the late line goes first or last by
 * setting, then the lines in their order. Returns what lands on each line and what is left over (it becomes an advance).
 */
export function allocatePlan(invoices: CalcInvoice[], amount: number, o: { lateFirst: boolean }) {
  const rank = (l: CalcLine) => (l.kind === "late" ? (o.lateFirst ? -1 : 1) : 0);
  const room = new Map<string, number>(), cap = new Map<string, number>(), lines = new Map<string, CalcLine[]>();
  for (const inv of invoices) {
    cap.set(inv.id, inv.limit ?? Infinity);
    lines.set(inv.id, inv.lines.filter((l) => openOf(l) > 0).sort((a, b) => rank(a) - rank(b) || a.sort - b.sort || a.id.localeCompare(b.id)));
    for (const l of inv.lines) room.set(l.id, openOf(l));
  }
  const slices = invoices.flatMap((inv) => slicesOf(inv, invoiceOpen(inv)).map((s) => ({ inv, ...s })))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.inv.id.localeCompare(b.inv.id));
  const parts: { invoiceId: string; lineId: string; amountPaise: number }[] = [];
  let left = amount;
  for (const s of slices) {
    let want = Math.min(s.openPaise, left, cap.get(s.inv.id)!);
    for (const l of lines.get(s.inv.id)!) {
      const take = Math.min(room.get(l.id)!, want);
      if (take <= 0) continue;
      const last = parts.at(-1);
      if (last && last.lineId === l.id) last.amountPaise += take; else parts.push({ invoiceId: s.inv.id, lineId: l.id, amountPaise: take });
      room.set(l.id, room.get(l.id)! - take);
      want -= take; left -= take; cap.set(s.inv.id, cap.get(s.inv.id)! - take);
    }
  }
  // A line can be reached by two slices of one bill; merge so each line appears once.
  const merged = new Map<string, { invoiceId: string; lineId: string; amountPaise: number }>();
  for (const p of parts) { const m = merged.get(p.lineId); if (m) m.amountPaise += p.amountPaise; else merged.set(p.lineId, { ...p }); }
  return { parts: [...merged.values()], leftover: left };
}

/**
 * Concessions on a bill's lines: head-specific ones first, then whole-bill ones, each capped at what is left; spread
 * exactly. Deposits and other non-fee lines take none. `applied` is what each concession actually gave on this bill.
 */
export function concessionsDetailed(lines: { headId?: string | null; kind?: string; amountPaise: number }[], concs: Conc[]): { perLine: number[]; applied: number[] } {
  const out = lines.map(() => 0);
  const applied = concs.map(() => 0);
  const eligible = lines.map((l, i) => (l.kind ?? "fee") === "fee" ? i : -1).filter((i) => i >= 0);
  const room = (i: number) => lines[i]!.amountPaise - out[i]!;
  const order = concs.map((c, i) => ({ c, i })).sort((x, y) => Number(!!y.c.headId) - Number(!!x.c.headId));
  for (const { c, i: ci } of order) {
    const idx = eligible.filter((i) => !c.headId || lines[i]!.headId === c.headId);
    const base = idx.reduce((s, i) => s + room(i), 0);
    const want = c.mode === "percent" ? percentOf(idx.reduce((s, i) => s + lines[i]!.amountPaise, 0), c.value) : c.value;
    const give = Math.min(want, base);
    applied[ci] = give;
    apportion(give, idx.map(room)).forEach((p, k) => { out[idx[k]!] = out[idx[k]!]! + p; });
  }
  return { perLine: out, applied };
}

export const concessionsOn = (lines: Parameters<typeof concessionsDetailed>[0], concs: Conc[]): number[] => concessionsDetailed(lines, concs).perLine;

/** What one bill's share of a yearly amount is: the pool left divided by the bills still to come (the last one takes the rest, so the year adds up exactly). */
export const yearShare = (poolLeft: number, billsLeft: number) => (billsLeft <= 1 ? poolLeft : Math.floor(poolLeft / billsLeft));

/** What a draft bill comes to, with the concessions on it. */
export function previewInvoice(draft: { lines: { headId?: string | null; kind?: string; label?: string; amountPaise: number }[]; concessions?: Conc[] }) {
  const conc = concessionsOn(draft.lines, draft.concessions ?? []);
  const lines = draft.lines.map((l, i) => ({ ...l, concessionPaise: conc[i]! }));
  const grossPaise = lines.reduce((s, l) => s + l.amountPaise, 0);
  const concessionPaise = conc.reduce((s, c) => s + c, 0);
  return { lines, grossPaise, concessionPaise, duePaise: grossPaise - concessionPaise };
}
