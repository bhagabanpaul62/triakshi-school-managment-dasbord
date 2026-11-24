// Pure helpers for the finance components. No React, no imports: runs under plain node for logic.check.ts.

export type StateTone = "default" | "success" | "warning" | "danger" | "info";

/* ------------------------------ money text ------------------------------ */

/** Strip rupee sign, commas and spaces. Returns the clean text, or null when it is not an amount or has more than 2 decimals. */
export function cleanAmount(raw: string): string | null {
  const t = raw.replace(/₹|rs\.?|inr|,|\s/gi, "");
  if (!/^\d*\.?\d*$/.test(t)) return null;
  const [, frac = ""] = t.split(".");
  return frac.length > 2 ? null : t;
}

/** Clean amount text to integer paise, with no floating point. null for an empty or half typed value. */
export function toPaise(clean: string): number | null {
  if (!/\d/.test(clean)) return null;
  const [whole = "", frac = ""] = clean.split(".");
  const p = Number(whole || "0") * 100 + Number(frac.padEnd(2, "0") || "0");
  return Number.isSafeInteger(p) ? p : null;
}

/** Paise to editable text: 120000 -> "1200", 120050 -> "1200.50". */
export function fromPaise(p: number): string {
  const whole = Math.trunc(p / 100);
  const frac = p % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}

/** Indian digit grouping for clean text: "1234567.5" -> "12,34,567.5". */
export function groupIndian(clean: string): string {
  const [whole = "", frac] = clean.split(".");
  const head = whole.length > 3 ? whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + whole.slice(-3) : whole;
  return frac === undefined ? head : `${head}.${frac}`;
}

/** "₹1,23,456" or "₹1,23,456.50"; `fixed` always shows two decimals. */
export function formatPaise(p: number, opts: { fixed?: boolean; sign?: "auto" | "always" | "abs" } = {}): string {
  const abs = Math.abs(p);
  const whole = groupIndian(String(Math.trunc(abs / 100)));
  const frac = abs % 100;
  const body = `₹${whole}${opts.fixed || frac ? "." + String(frac).padStart(2, "0") : ""}`;
  if (opts.sign === "abs" || p === 0) return body;
  if (p < 0) return `-${body}`;
  return opts.sign === "always" ? `+${body}` : body;
}

/* ------------------------------ splits ------------------------------ */

export interface SplitState { assigned: number; left: number; over: number; done: boolean }

/** How a total is covered by amounts. left is what remains, over what exceeds. */
export function splitState(total: number, amounts: number[]): SplitState {
  const assigned = amounts.reduce((s, a) => s + a, 0);
  return { assigned, left: Math.max(0, total - assigned), over: Math.max(0, assigned - total), done: assigned === total };
}

/* ------------------------------ line items ------------------------------ */

export function moveItem<T>(list: readonly T[], from: number, dir: -1 | 1): T[] {
  const to = from + dir;
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export function duplicateAt<T>(list: readonly T[], i: number, copy: (item: T) => T): T[] {
  const item = list[i];
  if (item === undefined) return [...list];
  const next = [...list];
  next.splice(i + 1, 0, copy(item));
  return next;
}

export const sumPaise = (xs: readonly { amountPaise: number }[]): number => xs.reduce((s, x) => s + x.amountPaise, 0);

/* ------------------------------ bars ------------------------------ */

/** Whole-number shares that add to 100 (largest remainder), so a legend never reads 99% or 101%. All zero gives all zero. */
export function shares(values: readonly number[]): number[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total === 0) return values.map(() => 0);
  const exact = values.map((v) => (Math.max(0, v) * 100) / total);
  const out = exact.map(Math.floor);
  let rest = 100 - out.reduce((s, v) => s + v, 0);
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (rest-- <= 0) break; out[i] = (out[i] ?? 0) + 1; }
  return out;
}

export interface Variance { pct: number | null; diff: number; over: boolean; scaleMax: number }

/** actual against budget. pct is null when there is no budget. scaleMax is the bar's full width. */
export function variance(actual: number, budget: number): Variance {
  return { pct: budget > 0 ? Math.round((actual * 100) / budget) : null, diff: actual - budget, over: actual > budget, scaleMax: Math.max(actual, budget, 1) };
}

/** SVG path for a sparkline inside width x height with `pad` room. Fewer than 2 points gives an empty path. */
export function sparkPath(points: readonly number[], width: number, height: number, pad = 2): { d: string; last: [number, number] | null } {
  if (points.length < 2) return { d: "", last: null };
  const min = Math.min(...points);
  const span = Math.max(...points) - min || 1;
  const xy = points.map((v, i): [number, number] => [pad + (i * (width - 2 * pad)) / (points.length - 1), height - pad - ((v - min) * (height - 2 * pad)) / span]);
  const r = (n: number) => Math.round(n * 10) / 10;
  return { d: xy.map(([x, y], i) => `${i ? "L" : "M"}${r(x)} ${r(y)}`).join(" "), last: xy[xy.length - 1] ?? null };
}

/* ------------------------------ report ------------------------------ */

/** Sum of each numeric key over the rows (integer paise or counts). */
export function sumKeys(rows: readonly Record<string, unknown>[], keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = rows.reduce((s, r) => s + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);
  return out;
}

export function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/* ------------------------------ time ------------------------------ */

const pad2 = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type PeriodKind = "month" | "quarter" | "fy" | "custom";
export interface Period { kind: PeriodKind; from: string; to: string }
export type PresetKey = "this_month" | "last_month" | "this_quarter" | "last_quarter" | "this_fy" | "last_fy";

/** Indian financial year: April to March. Returns the calendar year it starts in. */
export const fyStartOf = (day: string): number => { const y = Number(day.slice(0, 4)); return Number(day.slice(5, 7)) >= 4 ? y : y - 1; };

export const monthPeriod = (y: number, m: number): Period => ({ kind: "month", from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)) });
export const fyPeriod = (startYear: number): Period => ({ kind: "fy", from: iso(startYear, 4, 1), to: iso(startYear + 1, 3, 31) });
/** q is 1 to 4 inside the financial year that starts in startYear: Q1 = Apr to Jun. */
export function quarterPeriod(startYear: number, q: number): Period {
  const m0 = 4 + (q - 1) * 3;
  const y0 = m0 > 12 ? startYear + 1 : startYear;
  const startM = ((m0 - 1) % 12) + 1;
  const endM0 = m0 + 2;
  const endM = ((endM0 - 1) % 12) + 1;
  const endY = endM0 > 12 ? startYear + 1 : startYear;
  return { kind: "quarter", from: iso(y0, startM, 1), to: iso(endY, endM, lastDay(endY, endM)) };
}

export function presetPeriod(key: PresetKey, today: string): Period {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const fy = fyStartOf(today);
  const q = Math.floor(((m - 4 + 12) % 12) / 3) + 1;
  switch (key) {
    case "this_month": return monthPeriod(y, m);
    case "last_month": return m === 1 ? monthPeriod(y - 1, 12) : monthPeriod(y, m - 1);
    case "this_quarter": return quarterPeriod(fy, q);
    case "last_quarter": return q === 1 ? quarterPeriod(fy - 1, 4) : quarterPeriod(fy, q - 1);
    case "this_fy": return fyPeriod(fy);
    case "last_fy": return fyPeriod(fy - 1);
  }
}

/** URL form: "2026-11", "2026-Q3" (financial year start and quarter), "FY2026", or "custom" with from and to. */
export function periodParams(p: Period): { period: string; from?: string; to?: string } {
  if (p.kind === "month") return { period: p.from.slice(0, 7) };
  if (p.kind === "fy") return { period: `FY${p.from.slice(0, 4)}` };
  if (p.kind === "quarter") return { period: `${fyStartOf(p.from)}-Q${Math.floor(((Number(p.from.slice(5, 7)) - 4 + 12) % 12) / 3) + 1}` };
  return { period: "custom", from: p.from, to: p.to };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Read a period from search params; anything unreadable falls back to this month. */
export function parsePeriod(sp: { period?: string | null; from?: string | null; to?: string | null }, today: string): Period {
  const v = sp.period ?? "";
  let m: RegExpMatchArray | null;
  if ((m = v.match(/^(\d{4})-(0[1-9]|1[0-2])$/))) return monthPeriod(Number(m[1]), Number(m[2]));
  if ((m = v.match(/^FY(\d{4})$/))) return fyPeriod(Number(m[1]));
  if ((m = v.match(/^(\d{4})-Q([1-4])$/))) return quarterPeriod(Number(m[1]), Number(m[2]));
  if (v === "custom" && sp.from && sp.to && DAY.test(sp.from) && DAY.test(sp.to) && sp.from <= sp.to) return { kind: "custom", from: sp.from, to: sp.to };
  return presetPeriod("this_month", today);
}

const dmy = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

export function periodLabel(p: Period): string {
  const fy = fyStartOf(p.from);
  const fyName = `${fy}-${String(fy + 1).slice(2)}`;
  if (p.kind === "month") return `${MONTHS[Number(p.from.slice(5, 7)) - 1]} ${p.from.slice(0, 4)}`;
  if (p.kind === "fy") return `FY ${fyName}`;
  if (p.kind === "quarter") return `Q${Math.floor(((Number(p.from.slice(5, 7)) - 4 + 12) % 12) / 3) + 1} FY ${fyName}`;
  return `${dmy(p.from)} to ${dmy(p.to)}`;
}

/** The calendar day (YYYY-MM-DD) of a date or date-time string, in Indian time for date-times. */
export function dayKey(at: string): string {
  if (DAY.test(at)) return at;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Keeps the input order inside each day; days come out newest first. */
export function groupByDay<T extends { at: string }>(items: readonly T[]): { day: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const it of items) { const k = dayKey(it.at); (map.get(k) ?? map.set(k, []).get(k)!).push(it); }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, list]) => ({ day, items: list }));
}

/* ------------------------------ states ------------------------------ */

/** Red = act now, amber = watch, green = fine, neutral = nothing to do, blue = moving along. */
export const STATE_MAP: Record<string, { label: string; tone: StateTone }> = {
  // invoice, as a person sees it
  draft: { label: "Draft", tone: "default" },
  upcoming: { label: "Upcoming", tone: "default" },
  due: { label: "Due", tone: "warning" },
  overdue: { label: "Overdue", tone: "danger" },
  part_paid: { label: "Part paid", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  cancelled: { label: "Cancelled", tone: "default" },
  // receipt
  valid: { label: "Valid", tone: "success" },
  clearing: { label: "Clearing", tone: "warning" },
  bounced: { label: "Bounced", tone: "danger" },
  reversed: { label: "Reversed", tone: "default" },
  // cheque
  received: { label: "Received", tone: "default" },
  deposited: { label: "Deposited", tone: "info" },
  cleared: { label: "Cleared", tone: "success" },
  // request: concession, waiver, refund, bill, claim
  pending: { label: "Waiting", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "default" },
  // family slip
  submitted: { label: "Submitted", tone: "warning" },
  verified: { label: "Verified", tone: "success" },
  // payroll run
  reviewed: { label: "Reviewed", tone: "info" },
  locked: { label: "Locked", tone: "success" },
  paid_out: { label: "Paid out", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  // period
  open: { label: "Open", tone: "success" },
  soft: { label: "Soft closed", tone: "warning" },
  closed: { label: "Closed", tone: "default" },
  // advances, plans, concessions
  spent: { label: "Spent", tone: "default" },
  published: { label: "Published", tone: "success" },
  archived: { label: "Archived", tone: "default" },
  ended: { label: "Ended", tone: "default" },
};

/** An unknown state shows its own text in neutral. */
export function stateInfo(state: string): { label: string; tone: StateTone } {
  return STATE_MAP[state] ?? { label: state.replace(/_/g, " "), tone: "default" };
}
