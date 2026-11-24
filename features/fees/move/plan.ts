// The pure part of the move: what the old tables become. No database, no clock (callers pass "today").
// Every amount is whole paise and every split uses `apportion`, so the new bills add up to the old numbers exactly.
import { apportion, percentOf } from "@smw/feature-kit/money";
import type { LateRule } from "../constants";
import { FeeCalculator, type CalcInput, type Statement, type StatementLine } from "./legacy-calculator";

export interface OldItem { headId: string; headName: string; headType: "income" | "deposit"; amountPaise: number }
export interface OldInstalment { id: string; name: string; dueDate: string; amountPaise: number }
export interface OldRule { installmentId: string | null; kind: "flat" | "per_day"; amountPaise: number; graceDays: number; maxPaise: number | null }
export interface OldStructure { id: string; yearId: string; classId: string; name: string; items: OldItem[]; installments: OldInstalment[]; lateRules: OldRule[] }
export interface OldConcession { id: string; headId: string | null; kind: "amount" | "percent"; value: number }
export interface OldCharge { id: string; kind: "transport" | "library_fine" | "other"; label: string; dueDate: string; amountPaise: number; sourceKey: string }
export interface OldAllocation { installmentId: string | null; chargeId: string | null; amountPaise: number; lateFeePaise: number }
/** A valid payment, with where each rupee went. */
export interface OldPayment { id: string; paidOn: string; amountPaise: number; allocations: OldAllocation[] }

/** The key a plan due carries: stable (made from the old instalment's id), so the move can be told apart and rerun. */
export const dueKeyOf = (instalmentId: string) => `inst-${instalmentId.replace(/-/g, "").slice(-12)}`;

const dueOrder = <T extends { dueDate: string; id: string }>(xs: T[]) => [...xs].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
export const sortedInstalments = (s: Pick<OldStructure, "installments">) => dueOrder(s.installments);

/** The old calculator takes the late rule of the instalment, else the one for all. */
export const lateRuleFor = (s: Pick<OldStructure, "lateRules">, instalmentId: string | null): LateRule | null => {
  const r = (instalmentId ? s.lateRules.find((x) => x.installmentId === instalmentId) : undefined) ?? s.lateRules.find((x) => x.installmentId === null);
  return r ? { kind: r.kind, amountPaise: r.amountPaise, graceDays: r.graceDays, maxPaise: r.maxPaise } : null;
};

/** What each head costs inside each instalment (in due order): the instalment spread over the structure's items. */
export function headAmounts(s: Pick<OldStructure, "items" | "installments">): number[][] {
  const weights = s.items.map((i) => i.amountPaise);
  return sortedInstalments(s).map((i) => apportion(i.amountPaise, weights));
}

/** Split `total` over `weights` but never more than `caps[i]` in one place; what a place cannot take goes to the others. */
export function cappedApportion(total: number, weights: number[], caps: number[]): number[] {
  const out = caps.map(() => 0);
  let left = total, active = caps.map((_, i) => i).filter((i) => caps[i]! > 0);
  while (left > 0 && active.length) {
    const w = active.map((i) => weights[i] ?? 0);
    const share = apportion(left, w.some((x) => x > 0) ? w : active.map((i) => caps[i]! - out[i]!));
    const full: number[] = [];
    active.forEach((i, k) => {
      const give = Math.min(share[k]!, caps[i]! - out[i]!);
      out[i]! += give; left -= give;
      if (out[i] === caps[i]) full.push(i);
    });
    if (!full.length && left > 0) break;
    active = active.filter((i) => !full.includes(i));
  }
  return out;
}

export interface ConcessionSplit {
  total: number;
  /** What each concession gave in all, in the order given. */
  applied: number[];
  /** Per instalment (due order): the old rule, the total spread by instalment size. */
  perInstalment: number[];
  /** Per instalment and head (item order). */
  perLine: number[][];
  /** [instalment][concession]: how much of each concession sits on each bill. */
  uses: number[][];
}

/**
 * The old concession rules, with the part each concession played kept: head ones first (capped at their head), then
 * whole-fee ones (a percent is of the gross, capped at what is left). The total is spread over the instalments by size.
 * Inside an instalment it lands on the heads that carry a concession, so a concession on Exam stays on the Exam line.
 */
export function splitConcessions(s: Pick<OldStructure, "items" | "installments">, concs: OldConcession[]): ConcessionSplit {
  const insts = sortedInstalments(s), amounts = headAmounts(s);
  const gross = insts.reduce((a, i) => a + i.amountPaise, 0);
  const left = new Map(s.items.map((i) => [i.headId, i.amountPaise]));
  const applied = concs.map(() => 0), perHead = new Map<string, number>();
  let total = 0;
  concs.forEach((c, i) => {
    if (!c.headId) return;
    const base = left.get(c.headId) ?? 0, amt = Math.min(base, c.kind === "percent" ? percentOf(base, c.value) : c.value);
    left.set(c.headId, base - amt); total += amt; applied[i] = amt;
    perHead.set(c.headId, (perHead.get(c.headId) ?? 0) + amt);
  });
  let whole = 0;
  concs.forEach((c, i) => {
    if (c.headId) return;
    const amt = Math.min(gross - total, c.kind === "percent" ? percentOf(gross, c.value) : c.value);
    total += amt; whole += amt; applied[i] = amt;
  });
  total = Math.min(total, gross);
  apportion(whole, s.items.map((i) => left.get(i.headId) ?? 0)).forEach((v, k) => perHead.set(s.items[k]!.headId, (perHead.get(s.items[k]!.headId) ?? 0) + v));

  const perInstalment = apportion(total, insts.map((i) => i.amountPaise));
  const perLine = insts.map((_, n) => cappedApportion(perInstalment[n]!, amounts[n]!.map((a, k) => ((perHead.get(s.items[k]!.headId) ?? 0) > 0 ? a : 0)), amounts[n]!));
  const room = perInstalment.slice();
  const uses = insts.map(() => concs.map(() => 0));
  concs.forEach((_, c) => {
    if (applied[c]! <= 0) return;
    cappedApportion(applied[c]!, room, room).forEach((v, n) => { uses[n]![c] = v; room[n]! -= v; });
  });
  return { total, applied, perInstalment, perLine, uses };
}

export interface PlannedLine { headId: string | null; kind: "fee" | "deposit"; label: string; amountPaise: number; concessionPaise: number }
/** A late fee that became a bill line: what was paid on it, and (for a fee never paid) nothing. */
export interface PlannedLate { amountPaise: number; date: string; paid: { paymentId: string; amountPaise: number }[] }
export interface PlannedBill {
  /** The old instalment or charge this bill comes from. */
  ref: string;
  kind: "plan" | "transport" | "library_fine" | "custom";
  dueKey: string | null;
  sourceKey: string | null;
  label: string;
  dueDate: string;
  issueDate: string;
  lateRule: LateRule | null;
  lines: PlannedLine[];
  uses: { concessionId: string; amountPaise: number }[];
  /** Money on the lines (index = line), in the order the payments came. */
  principal: { paymentId: string; lineIndex: number; amountPaise: number }[];
  late: PlannedLate[];
}
export interface YearInput {
  structure: OldStructure | null;
  concessions: OldConcession[];
  charges: OldCharge[];
  /** All valid payments of the student, oldest first. Allocations to other years are ignored here. */
  payments: OldPayment[];
  active: boolean;
  leftOn: string | null;
  today: string;
}
export interface YearPlan {
  bills: PlannedBill[];
  /** Principal paid beyond what a line could take (a concession added after money was paid): it becomes an advance. */
  credits: { paymentId: string; amountPaise: number }[];
  /** Instalments and charges not billed because the student had left, with no money on them. */
  skipped: string[];
  /** Per payment: how much of it (principal + late) this plan placed on a bill. */
  placed: Map<string, number>;
}

/**
 * Bills for one student in one year, and where each old payment sits on them. Instalments are billed whole (every
 * instalment of the structure), except for a student who left: only those with money on them or due by the day they left.
 */
export function planStudentYear(i: YearInput): YearPlan {
  const plan: YearPlan = { bills: [], credits: [], skipped: [], placed: new Map() };
  const s = i.structure;
  const insts = s ? sortedInstalments(s) : [];
  const split = s ? splitConcessions(s, i.concessions) : null;
  const amounts = s ? headAmounts(s) : [];
  const calc = new FeeCalculator({ items: [], installments: [], concessions: [], payments: [], lateRules: s?.lateRules ?? [], today: i.today });

  const touching = (ref: string) => i.payments.flatMap((p) => p.allocations.filter((a) => (a.installmentId ?? a.chargeId) === ref).map((a) => ({ p, a })));
  const keep = (ref: string, dueDate: string) => i.active || touching(ref).length > 0 || (!!i.leftOn && dueDate <= i.leftOn);

  const bill = (b: Omit<PlannedBill, "issueDate" | "principal" | "late">, instalment: OldInstalment | null): PlannedBill => {
    const events = touching(b.ref);
    const first = events.reduce<string | null>((m, e) => (m === null || e.p.paidOn < m ? e.p.paidOn : m), null);
    const out: PlannedBill = { ...b, issueDate: [b.dueDate, i.today, first ?? b.dueDate].sort()[0]!, principal: [], late: [] };
    const room = out.lines.map((l) => l.amountPaise - l.concessionPaise);
    let paidPrincipal = 0, clearedOn: string | null = null, latePaid = 0;
    const net = room.reduce((a, r) => a + r, 0);
    for (const { p, a } of events) {
      const open = room.reduce((x, r) => x + r, 0), take = Math.min(a.amountPaise, open);
      apportion(take, room).forEach((v, k) => { if (v > 0) { out.principal.push({ paymentId: p.id, lineIndex: k, amountPaise: v }); room[k]! -= v; } });
      if (a.amountPaise > take) plan.credits.push({ paymentId: p.id, amountPaise: a.amountPaise - take });
      paidPrincipal += a.amountPaise;
      if (clearedOn === null && paidPrincipal >= net) clearedOn = p.paidOn;
      if (a.lateFeePaise > 0) { out.late.push({ amountPaise: a.lateFeePaise, date: p.paidOn, paid: [{ paymentId: p.id, amountPaise: a.lateFeePaise }] }); latePaid += a.lateFeePaise; }
      plan.placed.set(p.id, (plan.placed.get(p.id) ?? 0) + a.amountPaise + a.lateFeePaise);
    }
    // The old calculator stops the late fee the day the principal is cleared and still owes what was not paid by then.
    if (instalment && net > 0 && room.every((r) => r === 0)) {
      const owed = Math.max(calc.lateFeeFor(instalment, clearedOn ?? i.today), latePaid) - latePaid;
      if (owed > 0) out.late.push({ amountPaise: owed, date: clearedOn ?? i.today, paid: [] });
    }
    return out;
  };

  insts.forEach((inst, n) => {
    if (!keep(inst.id, inst.dueDate)) { plan.skipped.push(inst.id); return; }
    const lines = s!.items.flatMap((it, k): PlannedLine[] => (amounts[n]![k]! > 0 ? [{ headId: it.headId, kind: it.headType, label: it.headName, amountPaise: amounts[n]![k]!, concessionPaise: split!.perLine[n]![k]! }] : []));
    const b = bill({ ref: inst.id, kind: "plan", dueKey: dueKeyOf(inst.id), sourceKey: null, label: inst.name, dueDate: inst.dueDate, lateRule: lateRuleFor(s!, inst.id), lines, uses: split!.uses[n]!.flatMap((v, c) => (v > 0 ? [{ concessionId: i.concessions[c]!.id, amountPaise: v }] : [])) }, inst);
    plan.bills.push(b);
  });
  for (const c of dueOrder(i.charges)) {
    if (!keep(c.id, c.dueDate)) { plan.skipped.push(c.id); continue; }
    plan.bills.push(bill({ ref: c.id, kind: c.kind === "other" ? "custom" : c.kind, dueKey: null, sourceKey: c.sourceKey, label: c.label, dueDate: c.dueDate, lateRule: null, lines: [{ headId: null, kind: "fee", label: c.label, amountPaise: c.amountPaise, concessionPaise: 0 }], uses: [] }, null));
  }
  return plan;
}

/** The input the old calculator wants for one student and year: only the allocations that land on this year's instalments and charges. */
export function legacyInput(s: OldStructure | null, charges: OldCharge[], concessions: OldConcession[], payments: OldPayment[], today: string): CalcInput {
  const mine = new Set([...(s?.installments.map((x) => x.id) ?? []), ...charges.map((c) => c.id)]);
  return {
    today,
    items: s?.items.map((x) => ({ headId: x.headId, amountPaise: x.amountPaise })) ?? [],
    installments: [...(s ? sortedInstalments(s).map((x) => ({ id: x.id, name: x.name, dueDate: x.dueDate, amountPaise: x.amountPaise })) : []), ...charges.map((c) => ({ id: c.id, name: c.label, dueDate: c.dueDate, amountPaise: c.amountPaise, charge: true }))],
    lateRules: s?.lateRules ?? [],
    concessions: concessions.map((c) => ({ headId: c.headId, kind: c.kind, value: c.value })),
    payments: payments.map((p) => ({ id: p.id, paidOn: p.paidOn, status: "valid" as const, allocations: p.allocations.filter((a) => mine.has((a.installmentId ?? a.chargeId)!)).map((a) => ({ installmentId: (a.installmentId ?? a.chargeId)!, amountPaise: a.amountPaise, lateFeePaise: a.lateFeePaise })) })),
  };
}

/** The numbers a student-year is compared on. `late` is the late fee in all (paid or still to come). */
export interface Numbers { gross: number; concession: number; late: number; paid: number; due: number }
export const NUMBER_KEYS = ["gross", "concession", "late", "paid", "due"] as const;

/** What the new tables must show for a student-year, from the old statement: lines that were not billed (a student who left) are taken out, and money paid beyond a line is an advance, not "paid". */
export function expectedNumbers(st: Statement, skipped: ReadonlySet<string>): { numbers: Numbers; credit: number; skippedLines: StatementLine[] } {
  const kept = st.lines.filter((l) => !skipped.has(l.installmentId));
  const sum = (f: (l: StatementLine) => number, from = kept) => from.reduce((a, l) => a + f(l), 0);
  const credit = sum((l) => Math.max(0, l.principalPaid - l.net));
  return {
    numbers: { gross: sum((l) => l.gross), concession: sum((l) => l.concession), late: sum((l) => l.lateFee), paid: sum((l) => l.paid) - credit, due: sum((l) => l.due) },
    credit,
    skippedLines: st.lines.filter((l) => skipped.has(l.installmentId)),
  };
}

/** The keys on which two sets of numbers differ. */
export const differences = (a: Numbers, b: Numbers) => NUMBER_KEYS.filter((k) => a[k] !== b[k]);
