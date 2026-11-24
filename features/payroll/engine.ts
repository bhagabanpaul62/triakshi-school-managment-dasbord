// The pay engine: pure, no database, no clock. Everything is whole paise; lines add up to the totals exactly.
// A statutory amount whose rate is missing is never guessed: the line comes back empty and flagged `needsInput`.
import { apportion, percentOf } from "@smw/feature-kit/money";
import type { COMPONENT_MODES } from "./constants";
import type { Slab } from "./rates";

export type LineKind = "earning" | "deduction" | "employer";
export type Mode = (typeof COMPONENT_MODES)[number];

export interface PayLine {
  kind: LineKind;
  /** A statutory key, "claim", "loan", an adjustment code, or null for the school's own component. */
  code: string | null;
  label: string;
  amountPaise: number;
  manual?: boolean;
  refId?: string | null;
  note?: string | null;
  needsInput?: boolean;
  sort: number;
}
export interface EngineComponent { id: string; label: string; kind: LineKind; mode: Mode; value: number; isBasic: boolean; isWage: boolean; proRata: boolean; taxable: boolean; sort: number }
export interface Days {
  calendarDays: number;
  /** Half-days not paid. 2 = one day. */
  unpaidHalfDays: number;
  hours?: number | null;
}
export interface Adjustment { kind: "earning" | "deduction"; code: string; label: string; amountPaise: number; taxable?: boolean; wage?: boolean; refId?: string | null; note?: string | null }
export interface EngineProfile { pan: boolean; regime: "new" | "old"; pfApplies: boolean | null; esiApplies: boolean | null; ptApplies: boolean | null; pfOnFullWages: boolean }
export interface TaxRates { slabs: [number | null, number][]; std: number; rebate: { upTo: number; max: number; marginal: boolean }; cessBp: number }
export interface PayRates {
  /** Days of the month under each PF ceiling (a month may span two). */
  pfCeilingSegments: { days: number; paise: number }[];
  pfEmployeeBp: number; pfEmployerBp: number; epsBp: number; edliBp: number; pfAdminBp: number; wageExclusionBp: number;
  esiCeiling: number; esiEmployeeBp: number; esiEmployerBp: number;
  /** Null: no rule for this state, so professional tax is typed. */
  pt: Slab[] | null;
  lwf: { employeePaise: number; employerPaise: number; months?: number[] } | null;
  tax: TaxRates | null;
  /** What the school has switched on. */
  config: { pf: boolean; esi: boolean; pt: boolean; lwf: boolean; tds: boolean };
}
export interface PayInput {
  assignment: { grossPaise: number; hourlyPaise?: number | null; overrides?: Record<string, number> };
  components: EngineComponent[];
  days: Days;
  adjustments?: Adjustment[];
  loans?: { loanId: string; emiPaise: number }[];
  claims?: { id: string; amountPaise: number; label: string }[];
  profile: EngineProfile;
  rates: PayRates;
  /** First day of the month paid for. */
  month: string;
  ytd?: { taxableGrossPaise: number; tdsPaise: number };
  declaration?: { otherIncomePaise: number; deductionsPaise: number; previousSalaryPaise: number; previousTdsPaise: number } | null;
  /** Amounts a person typed for a statutory code: they win over the worked-out amount. */
  typed?: Record<string, number>;
}
export type FlagCode = "needs_input" | "no_pan" | "gross_mismatch" | "no_basic" | "net_negative";
export interface Flag { code: FlagCode; line?: string; message: string }
export interface PayResult {
  lines: PayLine[];
  /** Earnings except reimbursements. */
  grossPaise: number;
  claimsPaise: number;
  deductionsPaise: number;
  employerPaise: number;
  /** Gross plus reimbursements minus deductions; below zero when deductions are too big. */
  netPaise: number;
  shortfallPaise: number;
  taxableGrossPaise: number;
  pfWagesPaise: number;
  flags: Flag[];
}

export const monthNumber = (month: string) => +month.slice(5, 7);
export const daysIn = (month: string) => new Date(Date.UTC(+month.slice(0, 4), monthNumber(month), 0)).getUTCDate();
/** April = 1 ... March = 12. */
const fyMonthIndex = (month: string) => ((monthNumber(month) + 8) % 12) + 1;

/** Tax on a yearly income by slabs: [upper limit (null = none), basis points]. */
export function slabTax(taxable: number, slabs: [number | null, number][]): number {
  let lower = 0, tax = 0;
  for (const [upper, bp] of slabs) {
    if (taxable <= lower) break;
    tax += percentOf(Math.min(taxable, upper ?? Infinity) - lower, bp);
    if (upper === null) break;
    lower = upper;
  }
  return tax;
}

/** Yearly tax with rebate, marginal relief and cess. */
export function yearlyTax(taxable: number, t: TaxRates): number {
  let tax = slabTax(taxable, t.slabs);
  if (taxable <= t.rebate.upTo) tax = Math.max(0, tax - t.rebate.max);
  else if (t.rebate.marginal) tax = Math.min(tax, taxable - t.rebate.upTo);
  return tax + percentOf(tax, t.cessBp);
}

/** The month's PF ceiling: each day under the ceiling that applied on it. */
export function pfCeiling(segments: PayRates["pfCeilingSegments"]): number {
  const days = segments.reduce((a, s) => a + s.days, 0);
  return Math.round(segments.reduce((a, s) => a + s.days * s.paise, 0) / Math.max(1, days));
}

/** The year's income, tax and what to deduct this month, from this month's taxable pay and what came before. */
export function taxProjection(p: Pick<PayInput, "month" | "ytd" | "declaration" | "profile">, taxableThisMonth: number, tax: TaxRates) {
  const left = 13 - fyMonthIndex(p.month);
  const d = p.declaration;
  const income = (p.ytd?.taxableGrossPaise ?? 0) + taxableThisMonth * left + (d?.previousSalaryPaise ?? 0) + (d?.otherIncomePaise ?? 0);
  const taxable = Math.max(0, income - tax.std - (p.profile.regime === "old" ? d?.deductionsPaise ?? 0 : 0));
  const yearly = yearlyTax(taxable, tax);
  const owed = yearly - (p.ytd?.tdsPaise ?? 0) - (d?.previousTdsPaise ?? 0);
  return { monthsLeft: left, incomePaise: income, taxablePaise: taxable, yearlyTaxPaise: yearly, monthlyPaise: Math.max(0, Math.round(owed / left)) };
}
const monthlyTds = (p: PayInput, taxableThisMonth: number, tax: TaxRates) => taxProjection(p, taxableThisMonth, tax).monthlyPaise;

/** What each earning component would be for a full month, before days are cut. */
function fullAmounts(earn: EngineComponent[], gross: number, overrides: Record<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  const set = (c: EngineComponent, v: number) => out.set(c.id, overrides[c.id] ?? v);
  for (const c of earn) if (c.mode === "fixed") set(c, c.value);
  for (const c of earn) if (c.mode === "percent_of_gross") set(c, percentOf(gross, c.value));
  const basic = earn.find((c) => c.isBasic);
  for (const c of earn) if (c.mode === "percent_of_basic") set(c, percentOf(basic ? out.get(basic.id) ?? 0 : 0, c.value));
  for (const c of earn) if (c.mode === "remainder") set(c, Math.max(0, gross - [...out.entries()].filter(([id]) => id !== c.id).reduce((a, [, v]) => a + v, 0)));
  return out;
}

export function computePay(p: PayInput): PayResult {
  const flags: Flag[] = [];
  const lines: PayLine[] = [];
  const add = (l: Omit<PayLine, "sort">) => { lines.push({ ...l, sort: lines.length }); };
  const den = p.days.calendarDays * 2;
  const paidHalf = Math.max(0, den - p.days.unpaidHalfDays);
  const factor = (v: number) => Math.round((v * paidHalf) / den);

  // ---- earnings
  let pfWages = 0, taxable = 0;
  const earn = p.components.filter((c) => c.kind === "earning").sort((a, b) => a.sort - b.sort);
  const prorated = new Map<string, number>();
  if (p.assignment.hourlyPaise != null) {
    const amount = Math.round((p.days.hours ?? 0) * p.assignment.hourlyPaise);
    add({ kind: "earning", code: "hourly", label: `Pay for ${p.days.hours ?? 0} hours`, amountPaise: amount });
    pfWages = taxable = amount;
  } else if (earn.length === 0) {
    const amount = factor(p.assignment.grossPaise);
    add({ kind: "earning", code: null, label: "Pay", amountPaise: amount });
    pfWages = taxable = amount;
  } else {
    const full = fullAmounts(earn, p.assignment.grossPaise, p.assignment.overrides ?? {});
    if (!earn.some((c) => c.isBasic)) flags.push({ code: "no_basic", message: "The structure has no basic component." });
    const fullTotal = [...full.values()].reduce((a, b) => a + b, 0);
    if (fullTotal !== p.assignment.grossPaise) flags.push({ code: "gross_mismatch", message: "The components do not add up to the gross pay. Add a remainder component to the structure." });
    const cut = earn.filter((c) => c.proRata);
    const target = factor(cut.reduce((a, c) => a + (full.get(c.id) ?? 0), 0));
    const shares = apportion(target, cut.map((c) => full.get(c.id) ?? 0));
    cut.forEach((c, i) => prorated.set(c.id, shares[i]!));
    for (const c of earn) {
      const amount = c.proRata ? prorated.get(c.id)! : full.get(c.id) ?? 0;
      add({ kind: "earning", code: null, label: c.label, amountPaise: amount, refId: c.id });
      if (c.isWage) pfWages += amount;
      if (c.taxable) taxable += amount;
    }
  }
  for (const a of p.adjustments ?? []) {
    if (a.kind !== "earning") continue;
    add({ kind: "earning", code: a.code, label: a.label, amountPaise: a.amountPaise, manual: true, refId: a.refId, note: a.note });
    if (a.wage) pfWages += a.amountPaise;
    if (a.taxable !== false) taxable += a.amountPaise;
  }
  const gross = lines.reduce((s, l) => s + l.amountPaise, 0);
  let claims = 0;
  for (const c of p.claims ?? []) { add({ kind: "earning", code: "claim", label: c.label, amountPaise: c.amountPaise, refId: c.id }); claims += c.amountPaise; }

  // ---- statutory
  const r = p.rates, pr = p.profile;
  const typed = (code: string, label: string, kind: LineKind, worked: number | null, ask: string) => {
    const t = p.typed?.[code];
    if (t !== undefined) add({ kind, code, label, amountPaise: t, manual: true });
    else if (worked === null) { add({ kind, code, label, amountPaise: 0, needsInput: true, note: ask }); flags.push({ code: "needs_input", line: code, message: ask }); }
    else if (worked > 0) add({ kind, code, label, amountPaise: worked });
  };
  const pfOn = pr.pfApplies ?? r.config.pf;
  const esiOn = pr.esiApplies ?? r.config.esi;
  const ptOn = pr.ptApplies ?? r.config.pt;
  let pfWagesUsed = 0;
  const employer: Omit<PayLine, "sort">[] = [];
  if (pfOn && pfWages > 0) {
    const wages = Math.max(pfWages, percentOf(gross, 10_000 - r.wageExclusionBp));
    pfWagesUsed = wages;
    const cap = pfCeiling(r.pfCeilingSegments);
    const capped = Math.min(wages, cap);
    const base = pr.pfOnFullWages ? wages : capped;
    const eps = percentOf(capped, r.epsBp);
    add({ kind: "deduction", code: "pf_employee", label: "Provident fund", amountPaise: percentOf(base, r.pfEmployeeBp) });
    employer.push({ kind: "employer", code: "pf_employer", label: "PF, employer share", amountPaise: Math.max(0, percentOf(base, r.pfEmployerBp) - eps) });
    employer.push({ kind: "employer", code: "eps_employer", label: "Pension (EPS)", amountPaise: eps });
    employer.push({ kind: "employer", code: "edli", label: "EDLI", amountPaise: percentOf(capped, r.edliBp) });
    employer.push({ kind: "employer", code: "pf_admin", label: "PF admin charges", amountPaise: percentOf(base, r.pfAdminBp) });
  }
  if (esiOn && gross > 0 && gross <= r.esiCeiling) {
    add({ kind: "deduction", code: "esi_employee", label: "ESI", amountPaise: percentOf(gross, r.esiEmployeeBp) });
    employer.push({ kind: "employer", code: "esi_employer", label: "ESI, employer share", amountPaise: percentOf(gross, r.esiEmployerBp) });
  }
  if (ptOn) {
    const m = monthNumber(p.month);
    const slab = r.pt ? [...r.pt].sort((a, b) => b.over - a.over).find((s) => gross > s.over) : undefined;
    typed("pt", "Professional tax", "deduction", r.pt === null ? null : slab ? (slab.special?.month === m ? slab.special.paise : slab.paise) : 0,
      "Professional tax has no rule for this person's state. Type the amount, or set the state on their pay details.");
  }
  if (r.config.lwf) {
    const l = r.lwf;
    const due = !l || !l.months || l.months.includes(monthNumber(p.month));
    typed("lwf_employee", "Labour welfare fund", "deduction", l ? (due ? l.employeePaise : 0) : null, "Labour welfare fund has no rule here. Type the amount or add the rate in Statutory.");
    if (l && due && l.employerPaise) employer.push({ kind: "employer", code: "lwf_employer", label: "LWF, employer share", amountPaise: l.employerPaise });
  }
  if (r.config.tds && taxable > 0) {
    typed("tds", "Income tax (TDS)", "deduction", r.tax ? monthlyTds(p, taxable, r.tax) : null, "There are no tax slabs for this year. Type the tax to deduct.");
    if (!pr.pan) flags.push({ code: "no_pan", message: "No PAN on file. Tax may be deducted at a higher rate." });
  }

  // ---- the school's own deductions and employer costs, then loans
  const own = (kind: LineKind) => p.components.filter((c) => c.kind === kind).sort((a, b) => a.sort - b.sort);
  const basicPaid = prorated.get(earn.find((c) => c.isBasic)?.id ?? "") ?? 0;
  const ownAmount = (c: EngineComponent) => {
    const v = p.assignment.overrides?.[c.id] ?? (c.mode === "fixed" ? c.value : percentOf(c.mode === "percent_of_basic" ? basicPaid : gross, c.value));
    return c.proRata && c.mode === "fixed" ? factor(v) : v;
  };
  for (const c of own("deduction")) add({ kind: "deduction", code: null, label: c.label, amountPaise: ownAmount(c), refId: c.id });
  for (const a of p.adjustments ?? []) if (a.kind === "deduction") add({ kind: "deduction", code: a.code, label: a.label, amountPaise: a.amountPaise, manual: true, refId: a.refId, note: a.note });
  for (const l of p.loans ?? []) if (l.emiPaise > 0) add({ kind: "deduction", code: "loan", label: "Loan recovery", amountPaise: l.emiPaise, refId: l.loanId });
  for (const e of employer) add(e);
  for (const c of own("employer")) add({ kind: "employer", code: null, label: c.label, amountPaise: ownAmount(c), refId: c.id });

  const sum = (kind: LineKind) => lines.filter((l) => l.kind === kind && l.code !== "claim").reduce((s, l) => s + l.amountPaise, 0);
  const deductions = sum("deduction"), employerTotal = sum("employer");
  const net = gross + claims - deductions;
  if (net < 0) flags.push({ code: "net_negative", message: "Deductions are more than the pay." });
  return { lines, grossPaise: gross, claimsPaise: claims, deductionsPaise: deductions, employerPaise: employerTotal, netPaise: net, shortfallPaise: Math.max(0, -net), taxableGrossPaise: taxable, pfWagesPaise: pfWagesUsed, flags };
}

/** The monthly wages gratuity and PF rest on: wage components, and never less than the share of pay the wage rule keeps. */
export function monthlyWages(components: EngineComponent[], grossPaise: number, overrides: Record<string, number>, wageExclusionBp: number): number {
  const earn = components.filter((c) => c.kind === "earning").sort((a, b) => a.sort - b.sort);
  if (!earn.length) return grossPaise;
  const full = fullAmounts(earn, grossPaise, overrides);
  const wages = earn.filter((c) => c.isWage).reduce((a, c) => a + (full.get(c.id) ?? 0), 0);
  return Math.max(wages, percentOf(grossPaise, 10_000 - wageExclusionBp));
}
