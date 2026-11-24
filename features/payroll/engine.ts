// The pay engine: pure, no database, no clock. Everything is whole paise; lines add up to the totals exactly.
// A statutory amount whose rate is missing is never guessed: the line comes back empty and flagged `needsInput`.
import { apportion, percentOf, rupees } from "@smw/feature-kit/money";
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
export interface EngineComponent { /** Where a deduction or employer cost is held (a liability account of the school). */ accountId?: string | null; id: string; label: string; kind: LineKind; mode: Mode; value: number; isBasic: boolean; isWage: boolean; proRata: boolean; taxable: boolean; sort: number }
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
  /** How each contribution is rounded: to the paisa, to the nearest rupee, or up to the next rupee. */
  rounding: Record<RoundKey, RoundMode>;
  /** Rates that have no row for this month. A contribution that rests on one is asked for, never worked out as zero. */
  missing?: string[];
}
export type RoundMode = "paise" | "nearest" | "up";
export type RoundKey = "esi_employee" | "esi_employer" | "pf_employee" | "pf_employer" | "eps";
/** `bp` basis points of `value`, rounded as the rule says. */
export function share(value: number, bp: number, mode: RoundMode): number {
  const n = value * bp;
  return mode === "up" ? Math.ceil(n / 1_000_000) * 100 : mode === "nearest" ? Math.round(n / 1_000_000) * 100 : Math.round(n / 10_000);
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
  /** Set when a raise or a joining date falls inside the month: each part is paid at its own rate for its own days. `days` is then the whole month's. */
  segments?: Segment[];
  /** Amounts a person typed for a statutory code: they win over the worked-out amount. */
  typed?: Record<string, number>;
  /** A payment outside the month's salary: it withholds only the tax its own amount adds to the year. */
  offCycle?: boolean;
  /** Pay already worked out for the rest of the year (a month's taxable pay and how many months), for the tax of an off-cycle payment. */
  taxBase?: { monthlyPaise: number; months: number };
  /** The person's last month: the year's remaining tax is withheld now. */
  finalMonth?: boolean;
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
  /** The part of taxable pay that is typed once (a bonus, arrears) and is not repeated in later months. */
  oneOffTaxablePaise: number;
  pfWagesPaise: number;
  /** Wages each contribution was worked on, stored with the pay so the returns never have to work them back. */
  epfWagesPaise: number; epsWagesPaise: number; edliWagesPaise: number; esiWagesPaise: number;
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

const regimeDeduction = (p: Pick<PayInput, "declaration" | "profile">) => (p.profile.regime === "old" ? p.declaration?.deductionsPaise ?? 0 : 0);
const earlier = (p: Pick<PayInput, "ytd" | "declaration">) => (p.ytd?.taxableGrossPaise ?? 0) + (p.declaration?.previousSalaryPaise ?? 0) + (p.declaration?.otherIncomePaise ?? 0);

/** The year's income, tax and what to deduct this month. `recurring` repeats in every month left; `oneOff` counts once. */
export function taxProjection(p: Pick<PayInput, "month" | "ytd" | "declaration" | "profile">, recurring: number, tax: TaxRates, o: { oneOff?: number; final?: boolean } = {}) {
  const left = o.final ? 1 : 13 - fyMonthIndex(p.month);
  const income = earlier(p) + recurring * left + (o.oneOff ?? 0);
  const taxable = Math.max(0, income - tax.std - regimeDeduction(p));
  const yearly = yearlyTax(taxable, tax);
  const owed = yearly - (p.ytd?.tdsPaise ?? 0) - (p.declaration?.previousTdsPaise ?? 0);
  return { monthsLeft: left, incomePaise: income, taxablePaise: taxable, yearlyTaxPaise: yearly, monthlyPaise: Math.max(0, Math.round(owed / left)) };
}

/** Tax on a payment outside the salary: the year's tax with it, less the year's tax without it, on the pay still expected. */
export function marginalTds(p: Pick<PayInput, "ytd" | "declaration" | "profile">, oneOff: number, tax: TaxRates, base: { monthlyPaise: number; months: number }): number {
  const yearly = (extra: number) => yearlyTax(Math.max(0, earlier(p) + base.monthlyPaise * base.months + extra - tax.std - regimeDeduction(p)), tax);
  return Math.max(0, yearly(oneOff) - yearly(0));
}
/** Months of the financial year after this one (April = 12 ... March = 0). */
export const monthsAfter = (month: string) => 12 - fyMonthIndex(month);

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


export interface Segment { assignment: PayInput["assignment"]; components: EngineComponent[]; days: Days; /** "1 to 14 Nov", shown on the payslip line. */ label: string }
interface Earned { code: string | null; label: string; refId: string | null; amount: number; wage: boolean; taxable: boolean; basic: boolean }

/** What one assignment earns over its own days: every component cut by the unpaid days of that part, split to the paisa. */
function partEarnings(assignment: PayInput["assignment"], components: EngineComponent[], days: Days, flags: Flag[]): Earned[] {
  const den = days.calendarDays * 2;
  const factor = (v: number) => Math.round((v * Math.max(0, den - days.unpaidHalfDays)) / den);
  const earn = components.filter((c) => c.kind === "earning").sort((a, b) => a.sort - b.sort);
  if (assignment.hourlyPaise != null) {
    const amount = Math.round((days.hours ?? 0) * assignment.hourlyPaise);
    return [{ code: "hourly", label: `Pay for ${days.hours ?? 0} hours`, refId: null, amount, wage: true, taxable: true, basic: false }];
  }
  if (earn.length === 0) return [{ code: null, label: "Pay", refId: null, amount: factor(assignment.grossPaise), wage: true, taxable: true, basic: false }];
  const full = fullAmounts(earn, assignment.grossPaise, assignment.overrides ?? {});
  if (!earn.some((c) => c.isBasic)) flags.push({ code: "no_basic", message: "The structure has no basic component." });
  if ([...full.values()].reduce((a, b) => a + b, 0) !== assignment.grossPaise) flags.push({ code: "gross_mismatch", message: "The components do not add up to the gross pay. Add a remainder component to the structure." });
  const cut = earn.filter((c) => c.proRata);
  const shares = apportion(factor(cut.reduce((a, c) => a + (full.get(c.id) ?? 0), 0)), cut.map((c) => full.get(c.id) ?? 0));
  const prorated = new Map(cut.map((c, i) => [c.id, shares[i]!]));
  return earn.map((c) => ({ code: null, label: c.label, refId: c.id, amount: c.proRata ? prorated.get(c.id)! : full.get(c.id) ?? 0, wage: c.isWage, taxable: c.taxable, basic: c.isBasic }));
}

export function computePay(p: PayInput): PayResult {
  const flags: Flag[] = [];
  const lines: PayLine[] = [];
  const add = (l: Omit<PayLine, "sort">) => { lines.push({ ...l, sort: lines.length }); };
  const den = p.days.calendarDays * 2;
  const factor = (v: number) => Math.round((v * Math.max(0, den - p.days.unpaidHalfDays)) / den);

  // ---- earnings: one part for a normal month, one per assignment when a raise or a joining falls inside it
  const parts = p.segments?.length ? p.segments : [{ assignment: p.assignment, components: p.components, days: p.days, label: "" }];
  const items = new Map<string, { code: string | null; label: string; refId: string | null; amount: number; wage: boolean; taxable: boolean; basic: boolean; parts: string[] }>();
  for (const part of parts) for (const it of partEarnings(part.assignment, part.components, part.days, flags)) {
    const key = `${it.code ?? ""}|${it.label}`;
    const have = items.get(key) ?? { ...it, amount: 0, parts: [] };
    have.amount += it.amount;
    have.parts.push(`${part.label}: ${rupees(it.amount)}`);
    items.set(key, have);
  }
  let pfWages = 0, taxable = 0, basicPaid = 0, oneOff = 0;
  for (const it of items.values()) {
    add({ kind: "earning", code: it.code, label: it.label, amountPaise: it.amount, refId: it.refId, note: parts.length > 1 ? it.parts.join("; ") : null });
    if (it.wage) pfWages += it.amount;
    if (it.taxable) taxable += it.amount;
    if (it.basic) basicPaid += it.amount;
  }
  for (const a of p.adjustments ?? []) {
    if (a.kind !== "earning") continue;
    add({ kind: "earning", code: a.code, label: a.label, amountPaise: a.amountPaise, manual: true, refId: a.refId, note: a.note });
    if (a.wage) pfWages += a.amountPaise;
    if (a.taxable !== false) { taxable += a.amountPaise; oneOff += a.amountPaise; }
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
  let pfWagesUsed = 0, epfWages = 0, epsWages = 0, esiWages = 0;
  const employer: Omit<PayLine, "sort">[] = [];
  const lacks = (keys: string[]) => {
    const m = keys.filter((k) => r.missing?.includes(k));
    if (m.length) flags.push({ code: "needs_input", line: "rates", message: `There is no ${m.map((k) => k.replace(/_/g, " ")).join(", ")} rule for this month. Add one under Statutory.` });
    return m.length > 0;
  };
  if (pfOn && pfWages > 0 && !lacks(["pf_ceiling", "pf_employee_bp", "pf_employer_bp", "eps_bp", "edli_bp", "pf_admin_bp", "wage_exclusion_bp"])) {
    const wages = Math.max(pfWages, percentOf(gross, 10_000 - r.wageExclusionBp));
    pfWagesUsed = wages;
    const cap = pfCeiling(r.pfCeilingSegments);
    const capped = Math.min(wages, cap);
    const base = pr.pfOnFullWages ? wages : capped;
    epfWages = base; epsWages = capped;
    // The pension share is rounded first; the employer's PF is the rounded total less that share.
    const eps = share(capped, r.epsBp, r.rounding.eps);
    add({ kind: "deduction", code: "pf_employee", label: "Provident fund", amountPaise: share(base, r.pfEmployeeBp, r.rounding.pf_employee) });
    employer.push({ kind: "employer", code: "pf_employer", label: "PF, employer share", amountPaise: Math.max(0, share(base, r.pfEmployerBp, r.rounding.pf_employer) - eps) });
    employer.push({ kind: "employer", code: "eps_employer", label: "Pension (EPS)", amountPaise: eps });
    employer.push({ kind: "employer", code: "edli", label: "EDLI", amountPaise: percentOf(capped, r.edliBp) });
    employer.push({ kind: "employer", code: "pf_admin", label: "PF admin charges", amountPaise: percentOf(base, r.pfAdminBp) });
  }
  if (esiOn && gross > 0 && !lacks(["esi_ceiling", "esi_employee_bp", "esi_employer_bp"]) && gross <= r.esiCeiling) {
    esiWages = gross;
    add({ kind: "deduction", code: "esi_employee", label: "ESI", amountPaise: share(gross, r.esiEmployeeBp, r.rounding.esi_employee) });
    employer.push({ kind: "employer", code: "esi_employer", label: "ESI, employer share", amountPaise: share(gross, r.esiEmployerBp, r.rounding.esi_employer) });
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
    const tds = !r.tax ? null : p.offCycle ? marginalTds(p, oneOff, r.tax, p.taxBase ?? { monthlyPaise: 0, months: 0 }) : taxProjection(p, taxable - oneOff, r.tax, { oneOff, final: p.finalMonth }).monthlyPaise;
    typed("tds", "Income tax (TDS)", "deduction", tds, "There are no tax slabs for this year. Type the tax to deduct.");
    if (!pr.pan) flags.push({ code: "no_pan", message: "No PAN on file. Tax may be deducted at a higher rate." });
  }

  // ---- the school's own deductions and employer costs, then loans
  const own = (kind: LineKind) => p.components.filter((c) => c.kind === kind).sort((a, b) => a.sort - b.sort);
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
  return { lines, grossPaise: gross, claimsPaise: claims, deductionsPaise: deductions, employerPaise: employerTotal, netPaise: net, shortfallPaise: Math.max(0, -net), taxableGrossPaise: taxable, oneOffTaxablePaise: oneOff, pfWagesPaise: pfWagesUsed, epfWagesPaise: epfWages, epsWagesPaise: epsWages, edliWagesPaise: epsWages, esiWagesPaise: esiWages, flags };
}

/** The monthly wages gratuity and PF rest on: wage components, and never less than the share of pay the wage rule keeps. */
export function monthlyWages(components: EngineComponent[], grossPaise: number, overrides: Record<string, number>, wageExclusionBp: number): number {
  const earn = components.filter((c) => c.kind === "earning").sort((a, b) => a.sort - b.sort);
  if (!earn.length) return grossPaise;
  const full = fullAmounts(earn, grossPaise, overrides);
  const wages = earn.filter((c) => c.isWage).reduce((a, c) => a + (full.get(c.id) ?? 0), 0);
  return Math.max(wages, percentOf(grossPaise, 10_000 - wageExclusionBp));
}
