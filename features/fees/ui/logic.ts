// Pure rules of the fee screens: no React, no database. The plan builder, the invoice editor and the settlement
// builder compute with these, so what the screen shows is what the services will see. Money is integer paise.
import { addDays, apportion, inWords, rupees } from "@smw/feature-kit/money";
import { formatPaise } from "@smw/ui/finance/logic";
import type { DocumentConfig, DocumentData } from "@smw/ui/finance/document-types";
import { copyLabels } from "@smw/feature-finance/templates/config";
import { lateFee, openOf } from "../calc";
import type { LateRule } from "../constants";

// ---------- dates ----------

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** "10 Dec 2026". */
export const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${MONTH[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/** `n` months on with the same day of the month, held to the month's last day (31 Jan + 1 month = 28 Feb). */
export function addMonthsKeepDay(day: string, n: number): string {
  const t = Number(day.slice(5, 7)) - 1 + n, y = Number(day.slice(0, 4)) + Math.floor(t / 12), m = (t % 12 + 12) % 12 + 1;
  return iso(y, m, Math.min(Number(day.slice(8, 10)), lastDay(y, m)));
}

// ---------- plan schedules ----------

export const SCHEDULES = [["monthly", "Every month"], ["quarterly", "Every quarter"], ["term", "Every term"], ["yearly", "Once a year"], ["once", "One time"], ["custom", "Own dates"]] as const;
export type Schedule = (typeof SCHEDULES)[number][0];
export interface YearSpan { startsOn: string; endsOn: string }
export interface PlanDue { dueKey: string; label: string; billOn: string; dueOn: string; amountPaise: number }
export interface ScheduleOptions {
  /** Day of the month a due falls on. */
  dueDay: number;
  /** The bill is made this many days before it falls due. */
  leadDays: number;
  /** How many terms in the year (term schedule). */
  terms: number;
  /** Own dates (custom schedule). */
  dates: string[];
  /** "each": the amount is charged every time. "total": the amount is the year's total, split evenly. */
  basis: "each" | "total";
}
export const DEFAULT_SCHEDULE: ScheduleOptions = { dueDay: 10, leadDays: 7, terms: 2, dates: [], basis: "each" };

/**
 * The dues one fee makes in an academic year. A due's key is what ties dues of different fees into one bill:
 * every fee that is due on the same key lands on one invoice. Dates are generated, then the school edits any of them.
 */
export function generateDues(schedule: Schedule, year: YearSpan, amountPaise: number, opt: Partial<ScheduleOptions> = {}): PlanDue[] {
  const o = { ...DEFAULT_SCHEDULE, ...opt };
  const y0 = Number(year.startsOn.slice(0, 4)), m0 = Number(year.startsOn.slice(5, 7));
  const months = Math.max(1, Math.min(12, (Number(year.endsOn.slice(0, 4)) * 12 + Number(year.endsOn.slice(5, 7))) - (y0 * 12 + m0) + 1));
  const on = (offset: number) => {
    const t = m0 - 1 + offset, y = y0 + Math.floor(t / 12), m = (t % 12) + 1;
    const d = iso(y, m, Math.min(Math.max(1, o.dueDay), lastDay(y, m)));
    return d < year.startsOn ? year.startsOn : d;
  };
  const make = (dueKey: string, label: string, dueOn: string): PlanDue => ({ dueKey, label, dueOn, billOn: addDays(dueOn, -Math.max(0, o.leadDays)), amountPaise });
  let dues: PlanDue[];
  if (schedule === "monthly") dues = Array.from({ length: months }, (_, i) => { const d = on(i); return make(d.slice(0, 7), `${MONTH[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`, d); });
  else if (schedule === "quarterly") dues = Array.from({ length: Math.max(1, Math.floor(months / 3)) }, (_, i) => make(`Q${i + 1}`, `Quarter ${i + 1}`, on(i * 3)));
  else if (schedule === "term") { const n = Math.max(1, Math.min(6, o.terms)); dues = Array.from({ length: n }, (_, i) => make(`T${i + 1}`, `Term ${i + 1}`, on(Math.floor((i * months) / n)))); }
  else if (schedule === "yearly") dues = [make("YEAR", "Yearly", on(0))];
  else if (schedule === "once") dues = [make("ONCE", "One time", on(0))];
  else dues = [...new Set(o.dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort().map((d) => make(`D${d}`, dayLabel(d), d));
  if (o.basis === "total" && dues.length) apportion(amountPaise, dues.map(() => 1)).forEach((p, i) => { dues[i]!.amountPaise = p; });
  return dues;
}

export interface PlanLineDraft { headId: string; optional: boolean; dues: PlanDue[] }
export interface PlanTotals {
  /** What a student who takes no optional fee pays over the year. */
  yearPaise: number;
  optionalPaise: number;
  byHead: { headId: string; totalPaise: number; optional: boolean }[];
  /** One entry per bill: the dues that share a key, earliest first. */
  byDue: { dueKey: string; label: string; dueOn: string; requiredPaise: number; optionalPaise: number }[];
}

export function planTotals(lines: PlanLineDraft[]): PlanTotals {
  const byHead = lines.map((l) => ({ headId: l.headId, optional: l.optional, totalPaise: l.dues.reduce((s, d) => s + d.amountPaise, 0) }));
  const keys = new Map<string, PlanTotals["byDue"][number]>();
  for (const l of lines) for (const d of l.dues) {
    const e = keys.get(d.dueKey) ?? { dueKey: d.dueKey, label: d.label, dueOn: d.dueOn, requiredPaise: 0, optionalPaise: 0 };
    if (d.dueOn < e.dueOn) e.dueOn = d.dueOn;
    e[l.optional ? "optionalPaise" : "requiredPaise"] += d.amountPaise;
    keys.set(d.dueKey, e);
  }
  return {
    yearPaise: byHead.filter((h) => !h.optional).reduce((s, h) => s + h.totalPaise, 0),
    optionalPaise: byHead.filter((h) => h.optional).reduce((s, h) => s + h.totalPaise, 0),
    byHead, byDue: [...keys.values()].sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.dueKey.localeCompare(b.dueKey)),
  };
}

/** What a plan has to hold before it can be saved, in plain words; empty when it is fine. */
export function planProblems(p: { name: string; classIds: string[]; lines: (PlanLineDraft & { headName?: string })[] }): string[] {
  const out: string[] = [];
  if (p.name.trim().length < 2) out.push("Name the plan.");
  if (!p.classIds.length) out.push("Pick at least one class.");
  if (!p.lines.length) out.push("Add at least one fee.");
  const heads = p.lines.map((l) => l.headId);
  if (new Set(heads).size !== heads.length) out.push("Each fee can be added only once.");
  for (const l of p.lines) {
    const name = l.headName ?? "A fee";
    if (!l.dues.length) out.push(`${name} has no due dates.`);
    if (l.dues.some((d) => d.amountPaise <= 0)) out.push(`${name} has a due with no amount.`);
    if (l.dues.some((d) => d.dueOn < d.billOn)) out.push(`${name} has a due date before its bill date.`);
    if (new Set(l.dues.map((d) => d.dueKey)).size !== l.dues.length) out.push(`${name} repeats a due date.`);
  }
  return out;
}

// ---------- comparing versions and years ----------

export interface PlanShape { lines: { headId: string; headName: string; optional: boolean; dues: { dueKey: string; dueOn: string; amountPaise: number }[] }[] }
export interface PlanChange { kind: "added" | "removed" | "amount" | "dates" | "optional"; headName: string; detail: string; deltaPaise: number }

const headTotal = (l: PlanShape["lines"][number]) => l.dues.reduce((s, d) => s + d.amountPaise, 0);
const required = (p: PlanShape) => p.lines.filter((l) => !l.optional).reduce((s, l) => s + headTotal(l), 0);

/** What changed from one version of a plan to the next, head by head, and the change in what a student pays over the year. */
export function diffPlans(from: PlanShape, to: PlanShape) {
  const changes: PlanChange[] = [];
  for (const n of to.lines) {
    const o = from.lines.find((l) => l.headId === n.headId);
    if (!o) { changes.push({ kind: "added", headName: n.headName, detail: `Added, ${rupees(headTotal(n))} over the year`, deltaPaise: n.optional ? 0 : headTotal(n) }); continue; }
    const [a, b] = [headTotal(o), headTotal(n)];
    if (a !== b) changes.push({ kind: "amount", headName: n.headName, detail: `${rupees(a)} to ${rupees(b)} over the year`, deltaPaise: n.optional ? 0 : b - a });
    const dates = (l: PlanShape["lines"][number]) => l.dues.map((d) => `${d.dueKey}@${d.dueOn}`).sort().join("|");
    if (dates(o) !== dates(n)) changes.push({ kind: "dates", headName: n.headName, detail: o.dues.length === n.dues.length ? "Due dates moved" : `${o.dues.length} dues became ${n.dues.length}`, deltaPaise: 0 });
    if (o.optional !== n.optional) changes.push({ kind: "optional", headName: n.headName, detail: n.optional ? "Now optional" : "Now required", deltaPaise: n.optional ? -a : b });
  }
  for (const o of from.lines) if (!to.lines.some((l) => l.headId === o.headId)) changes.push({ kind: "removed", headName: o.headName, detail: `Removed, was ${rupees(headTotal(o))} over the year`, deltaPaise: o.optional ? 0 : -headTotal(o) });
  const [fromPaise, toPaise] = [required(from), required(to)];
  return { changes, fromPaise, toPaise, deltaPaise: toPaise - fromPaise, percent: fromPaise ? Math.round(((toPaise - fromPaise) / fromPaise) * 1000) / 10 : null };
}

/** What revising a bill does to what the family owes, and whether it needs a second person. Lowering dues always does. */
export function reviseDifference(oldLines: { amountPaise: number; concessionPaise?: number; creditedPaise?: number; paidPaise?: number }[], newLines: { amountPaise: number }[]) {
  const oldOpenPaise = oldLines.reduce((s, l) => s + openOf({ id: "", kind: "fee", sort: 0, concessionPaise: 0, creditedPaise: 0, paidPaise: 0, ...l }), 0);
  const newPaise = newLines.reduce((s, l) => s + l.amountPaise, 0);
  const differencePaise = newPaise - oldOpenPaise;
  const needsApproval = differencePaise < 0;
  const why = differencePaise < 0 ? `This lowers what the family owes by ${rupees(-differencePaise)}, so an approver has to say yes before it counts.`
    : differencePaise > 0 ? `This raises what the family owes by ${rupees(differencePaise)}. No approval is needed.` : "The amount is the same. No approval is needed.";
  return { oldOpenPaise, newPaise, differencePaise, needsApproval, why };
}

// ---------- late fee in words ----------

export function lateRuleSentence(rule: LateRule | null | undefined): string {
  if (!rule) return "No late fee.";
  const when = rule.graceDays > 0 ? `after ${rule.graceDays} day${rule.graceDays === 1 ? "" : "s"} of grace` : "from the day after the due date";
  const cap = rule.maxPaise ? `, up to ${rupees(rule.maxPaise)} in all` : "";
  if (rule.kind === "flat") return `${rupees(rule.amountPaise ?? 0)} is added once, ${when}${cap}.`;
  if (rule.kind === "per_day") return `${rupees(rule.amountPaise ?? 0)} is added for every day late, ${when}${cap}.`;
  if (rule.kind === "percent") return `${(rule.basisPoints ?? 0) / 100}% of what is still unpaid is added once, ${when}${cap}.`;
  const steps = [...(rule.slabs ?? [])].sort((a, b) => a.afterDays - b.afterDays).map((s) => `${rupees(s.amountPaise)} after ${s.afterDays} days`);
  return `The fee steps up: ${steps.join(", ") || "no steps set"}, counted after ${rule.graceDays} days of grace${cap}.`;
}

/** The late fee of an example: a bill of `openPaise` paid `daysLate` days after its due date. */
export function lateExample(rule: LateRule | null | undefined, openPaise = 1_000_000, daysLate = 20) {
  const due = "2026-01-01";
  const feePaise = lateFee(rule, { dueOn: due, until: addDays(due, daysLate), openPaise, fixedPaise: 0 });
  return { feePaise, sentence: rule ? `Example: ${rupees(openPaise)} paid ${daysLate} days late costs ${rupees(feePaise)} extra, ${rupees(openPaise + feePaise)} in all.` : "" };
}

// ---------- the invoice on paper ----------

export interface PaperInput {
  number: string | null;
  issueDate: string | null;
  dueDate: string;
  label: string;
  student: { name: string; admissionNo: string; classLabel: string; guardian: string | null } | null;
  lines: { label: string; amountPaise: number; concessionPaise: number; latePaise?: number }[];
  note?: string | null;
  marks?: string[];
}
const fixed = (p: number) => formatPaise(p, { fixed: true });

/** The invoice as the document preview and the PDF show it. The labels of the facts and totals are the ones a school may hide. */
export function invoicePaperData(p: PaperInput): DocumentData {
  const rows = p.lines.map((l) => ({ item: l.label || "Untitled line", fee: fixed(l.amountPaise), concession: l.concessionPaise ? fixed(l.concessionPaise) : "", late: l.latePaise ? fixed(l.latePaise) : "", amount: fixed(l.amountPaise - l.concessionPaise + (l.latePaise ?? 0)) }));
  const gross = p.lines.reduce((s, l) => s + l.amountPaise, 0), conc = p.lines.reduce((s, l) => s + l.concessionPaise, 0), late = p.lines.reduce((s, l) => s + (l.latePaise ?? 0), 0);
  const due = gross - conc + late;
  const s = p.student;
  return {
    facts: [["Number", p.number ?? "Draft"], ["Date", p.issueDate ? dayLabel(p.issueDate) : "Not issued yet"], ["Student", s?.name ?? "Choose a student"], ["Admission no", s?.admissionNo ?? "-"], ["Class", s?.classLabel ?? "-"], ["Guardian", s?.guardian ?? "-"], ["For", p.label || "-"], ["Due date", p.dueDate ? dayLabel(p.dueDate) : "-"]],
    rows,
    totals: [["Total", fixed(gross)], ...(conc ? [["Concession", `-${fixed(conc)}`] as [string, string]] : []), ...(late ? [["Late fee", fixed(late)] as [string, string]] : []), ["Payable", fixed(due), true]],
    amountWords: due > 0 ? inWords(due) : null,
    notes: p.note ? [p.note] : [], marks: p.marks ?? [], qrSvg: null,
  };
}

/** The layout a document is drawn in: two-up prints both copy labels, the others the first. */
export function paperConfig<C extends DocumentConfig>(config: C, layout: DocumentConfig["layout"] = config.layout): C {
  const next = { ...config, layout };
  return { ...next, copies: copyLabels(next).filter((c): c is string => !!c) };
}

// ---------- settlements ----------

/** `count` dated parts of a total, one a month from `first`; the last takes the rounding. */
export function splitIntoParts(totalPaise: number, count: number, first: string): { dueOn: string; amountPaise: number }[] {
  if (totalPaise <= 0 || count < 1) return [];
  return apportion(totalPaise, Array.from({ length: count }, () => 1)).map((amountPaise, i) => ({ dueOn: addMonthsKeepDay(first, i), amountPaise }));
}

// ---------- the dashboard and lists ----------

export interface AgeingShape { notDue: number; d1_30: number; d31_60: number; d61_90: number; d90p: number }
/** AgeingBar buckets: each opens the dues report on that age band. */
export function ageingBuckets(a: AgeingShape, href = "/app/fees/dues") {
  const to = (band: string) => `${href}?age=${encodeURIComponent(band)}`;
  return [
    { label: "Not due yet", paise: a.notDue, href: to("not-due") },
    { label: "1 to 30 days", paise: a.d1_30, href: to("0-30") },
    { label: "31 to 60 days", paise: a.d31_60, href: to("31-60") },
    { label: "61 to 90 days", paise: a.d61_90, href: to("61-90") },
    { label: "Over 90 days", paise: a.d90p, href: to("90+") },
  ];
}

/** Whole days between two days, for "N days late" lines. */
export const daysLate = (due: string, today: string) => Math.max(0, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000));

/** A `?next=` target is followed only when it stays inside the app. */
export const safeNext = (v: string | undefined) => (v && /^\/app(\/|$)/.test(v) && !v.includes("//") ? v : undefined);
export const withNext = (href: string, next: string) => `${href}${href.includes("?") ? "&" : "?"}next=${encodeURIComponent(next)}`;
