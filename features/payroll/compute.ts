// Loads everything one month of pay rests on, runs the engine, and stores the result as items and lines.
// Shared by runs and exits; it checks no permission (the calling service did) and works inside the caller's transaction.
import { and, desc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { fyRange, monthEnd, fyOf } from "@smw/feature-kit/money";
import { staffProfiles } from "@smw/feature-staff/schema";
import type { PayConfig } from "./config";
import { computePay, daysIn, type Adjustment, type EngineComponent, type Flag, type PayResult } from "./engine";
import type { RateBook, RateUse } from "./rate-book";
import { payAssignments, payComponents, payDeclarations, payItems, payLines, payLoanRepayments, payLoans, payProfiles, payRuns } from "./schema";
import type { Sources } from "./sources";

/** Lines a person may type in place of the worked-out amount. */
export const TYPED_CODES = ["pt", "lwf_employee", "tds"] as const;
/** Codes of lines that are not pay for the month: they are not part of gross. */
export const STATUTORY_EMPLOYER = ["pf_employer", "eps_employer", "edli", "pf_admin", "esi_employer", "lwf_employer"];

export interface CalcEnv { tx: Tx; config: PayConfig; book: RateBook; sources: Sources; attendanceOn: boolean }
export type ItemRow = typeof payItems.$inferSelect;
export type LineRow = typeof payLines.$inferSelect;

export interface Computed { userId: string; result: PayResult; days: { calendarDays: number; unpaidHalfDays: number; unmarkedDays: number; hours: number | null }; used: RateUse[]; assignmentId: string; structureId: string; grossSetupPaise: number }

const half = (n: number) => Math.round(n * 2);

/** Unpaid days before the person joined, in half-days, when they joined inside this month. */
function beforeJoining(joining: string | null, month: string): number {
  return joining && joining > month && joining <= monthEnd(month) ? (+joining.slice(8) - 1) * 2 : 0;
}

/** `offCycle`: nothing is worked out from the structure; only typed lines count (a bonus, an arrears payment). */
export interface Request { userIds: string[]; month: string; runId: string | null; offCycle?: boolean; /** Half-days to count as unpaid on top of attendance, by person (the days after an exit). */ extraUnpaid?: Record<string, number>; leftOn?: Record<string, string>; existing?: Map<string, { item: ItemRow; lines: LineRow[] }> }

/** Work out the month's pay for each person who has a pay assignment. People without one are returned in `missing`. */
export async function computeMonth(env: CalcEnv, req: Request): Promise<{ done: Computed[]; missing: string[] }> {
  const { tx, config, book, sources } = env;
  const { userIds, month } = req;
  if (!userIds.length) return { done: [], missing: [] };
  const last = monthEnd(month), [fyFrom] = fyRange(fyOf(month));
  const [assigns, profiles, staff, decls] = await Promise.all([
    tx.select().from(payAssignments).where(and(inArray(payAssignments.userId, userIds), lte(payAssignments.fromDate, last))).orderBy(desc(payAssignments.fromDate)),
    tx.select().from(payProfiles).where(inArray(payProfiles.userId, userIds)),
    tx.select({ userId: staffProfiles.userId, joiningDate: staffProfiles.joiningDate }).from(staffProfiles).where(inArray(staffProfiles.userId, userIds)),
    tx.select().from(payDeclarations).where(and(inArray(payDeclarations.userId, userIds), eq(payDeclarations.fy, fyOf(month)))),
  ]);
  const assign = new Map<string, (typeof assigns)[number]>();
  for (const a of assigns) if (!assign.has(a.userId)) assign.set(a.userId, a);
  const structureIds = [...new Set([...assign.values()].map((a) => a.structureId))];
  const comps = structureIds.length ? await tx.select().from(payComponents).where(inArray(payComponents.structureId, structureIds)) : [];
  const attendance = env.attendanceOn && !req.offCycle ? await sources.days.monthDays(tx, userIds, month, { leftOn: req.leftOn }) : {};
  const joining = new Map(staff.map((s) => [s.userId, s.joiningDate]));

  // Year to date for tax: pay already approved this financial year, other runs only.
  const ytdRows = await tx.select({ userId: payItems.userId, snapshot: payItems.snapshot }).from(payItems).innerJoin(payRuns, eq(payRuns.id, payItems.runId))
    .where(and(inArray(payItems.userId, userIds), inArray(payRuns.status, ["approved", "paid"]), sql`${payRuns.month} >= ${fyFrom} and ${payRuns.month} <= ${month}`, req.runId ? ne(payRuns.id, req.runId) : undefined, sql`${payItems.skippedReason} is null`));
  const tdsRows = await tx.select({ userId: payItems.userId, amount: payLines.amountPaise }).from(payLines).innerJoin(payItems, eq(payItems.id, payLines.itemId)).innerJoin(payRuns, eq(payRuns.id, payItems.runId))
    .where(and(inArray(payItems.userId, userIds), eq(payLines.code, "tds"), inArray(payRuns.status, ["approved", "paid"]), sql`${payRuns.month} >= ${fyFrom} and ${payRuns.month} <= ${month}`, req.runId ? ne(payRuns.id, req.runId) : undefined, sql`${payItems.skippedReason} is null`));
  const ytd = new Map<string, { taxableGrossPaise: number; tdsPaise: number }>();
  for (const r of ytdRows) { const y = ytd.get(r.userId) ?? { taxableGrossPaise: 0, tdsPaise: 0 }; y.taxableGrossPaise += Number((r.snapshot as { taxableGrossPaise?: number }).taxableGrossPaise ?? 0); ytd.set(r.userId, y); }
  for (const r of tdsRows) { const y = ytd.get(r.userId) ?? { taxableGrossPaise: 0, tdsPaise: 0 }; y.tdsPaise += Number(r.amount); ytd.set(r.userId, y); }

  const loans = req.offCycle ? new Map<string, never[]>() : await openLoans(tx, userIds, month);
  const claims = await openClaims(env, userIds, req.runId);

  const done: Computed[] = [], missing: string[] = [];
  for (const userId of userIds) {
    const a = assign.get(userId);
    if (!a) { missing.push(userId); continue; }
    const p = profiles.find((x) => x.userId === userId) ?? null;
    const prior = req.existing?.get(userId);
    const att = attendance[userId];
    const cal = config.lopBasis === "fixed30" ? 30 : daysIn(month);
    const scale = (h: number) => (config.lopBasis === "fixed30" ? Math.round((h * 30) / daysIn(month)) : h);
    const unpaid = req.offCycle ? cal * 2 : env.attendanceOn && att
      ? half(att.absentDays) + att.unpaidLeaveHalfDays + beforeJoining(joining.get(userId) ?? null, month)
      : (prior?.item.unpaidHalfDays ?? 0);
    const unpaidAll = unpaid + (req.extraUnpaid?.[userId] ?? 0);
    const days = { calendarDays: cal, unpaidHalfDays: Math.min(cal * 2, scale(unpaidAll)), unmarkedDays: att?.unmarkedDays ?? 0, hours: prior?.item.hours != null ? Number(prior.item.hours) : null };
    const manual = (prior?.lines ?? []).filter((l) => l.manual);
    const typed: Record<string, number> = {};
    const adjustments: Adjustment[] = [];
    for (const l of manual) {
      if ((TYPED_CODES as readonly string[]).includes(l.code ?? "")) typed[l.code!] = Number(l.amountPaise);
      else if (l.kind !== "employer") adjustments.push({ kind: l.kind, code: l.code ?? "adjustment", label: l.label, amountPaise: Number(l.amountPaise), refId: l.refId, note: l.note });
    }
    const state = p?.state ?? config.state;
    const regime = p?.regime ?? "new";
    const { rates, used } = book.forMonth(month, { state, regime, config: req.offCycle ? { pf: false, esi: false, pt: false, lwf: false, tds: false } : config });
    const d = decls.find((x) => x.userId === userId);
    const result = computePay({
      assignment: { grossPaise: Number(a.grossPaise), hourlyPaise: a.hourlyPaise == null ? null : Number(a.hourlyPaise), overrides: a.overrides },
      components: comps.filter((c) => c.structureId === a.structureId).map((c): EngineComponent => ({ id: c.id, label: c.label, kind: c.kind, mode: c.mode, value: Number(c.value), isBasic: c.isBasic, isWage: c.isWage, proRata: c.proRata, taxable: c.taxable, sort: c.sort })),
      days, adjustments, typed, rates, month, ytd: ytd.get(userId),
      loans: (loans.get(userId) ?? []).map((l) => ({ loanId: l.id, emiPaise: l.emi })),
      claims: req.offCycle ? [] : (claims.get(userId) ?? []).map((c) => ({ id: c.id, amountPaise: c.amountPaise, label: c.label })),
      profile: { pan: !!p?.panSealed, regime, pfApplies: req.offCycle ? null : p?.pfApplies ?? null, esiApplies: req.offCycle ? null : p?.esiApplies ?? null, ptApplies: req.offCycle ? null : p?.ptApplies ?? null, pfOnFullWages: p?.pfOnFullWages ?? false },
      declaration: d ? { otherIncomePaise: Number(d.otherIncomePaise), deductionsPaise: Number(d.deductionsPaise), previousSalaryPaise: Number(d.previousSalaryPaise), previousTdsPaise: Number(d.previousTdsPaise) } : null,
    });
    done.push({ userId, result, days, used, assignmentId: a.id, structureId: a.structureId, grossSetupPaise: Number(a.grossPaise) });
  }
  return { done, missing };
}

/** Loans being recovered this month, with the EMI cut to what is still owed. */
export async function openLoans(tx: Tx, userIds: string[], month: string) {
  const rows = await tx.select().from(payLoans).where(and(inArray(payLoans.userId, userIds), sql`${payLoans.givenOn} is not null`, lte(payLoans.startsOn, monthEnd(month)),
    sql`(${payLoans.status} = 'active' or (${payLoans.status} = 'paused' and ${payLoans.pausedUntil} is not null and ${payLoans.pausedUntil} < ${month}))`)).orderBy(payLoans.createdAt);
  const paid = await repaid(tx, rows.map((r) => r.id));
  const out = new Map<string, { id: string; emi: number; balance: number }[]>();
  for (const l of rows) {
    const balance = Number(l.amountPaise) - (paid.get(l.id) ?? 0);
    if (balance <= 0) continue;
    out.set(l.userId, [...(out.get(l.userId) ?? []), { id: l.id, emi: Math.min(Number(l.emiPaise), balance), balance }]);
  }
  return out;
}

export async function repaid(tx: Tx, loanIds: string[]): Promise<Map<string, number>> {
  if (!loanIds.length) return new Map();
  const rows = await tx.select({ id: payLoanRepayments.loanId, v: sql<string>`sum(${payLoanRepayments.amountPaise})` }).from(payLoanRepayments).where(inArray(payLoanRepayments.loanId, loanIds)).groupBy(payLoanRepayments.loanId);
  return new Map(rows.map((r) => [r.id, Number(r.v)]));
}

/** Claims waiting to be paid with salary, except those already on another live run. */
async function openClaims(env: CalcEnv, userIds: string[], runId: string | null) {
  const open = await env.sources.claims.open(env.tx, userIds);
  const taken = open.length ? new Set((await env.tx.select({ ref: payLines.refId }).from(payLines).innerJoin(payItems, eq(payItems.id, payLines.itemId)).innerJoin(payRuns, eq(payRuns.id, payItems.runId))
    .where(and(eq(payLines.code, "claim"), inArray(payLines.refId, open.map((c) => c.id)), ne(payRuns.status, "cancelled"), runId ? ne(payRuns.id, runId) : undefined))).map((r) => r.ref)) : new Set();
  const out = new Map<string, typeof open>();
  for (const c of open) if (!taken.has(c.id)) out.set(c.userId, [...(out.get(c.userId) ?? []), c]);
  return out;
}

/** Store one person's result: the item row, and the lines the engine worked out (typed lines stay as they were). */
export async function saveItem(tx: Tx, schoolId: string, runId: string, c: Computed, extra: { skippedReason?: string | null } = {}): Promise<string> {
  const r = c.result;
  const snapshot = { taxableGrossPaise: r.taxableGrossPaise, pfWagesPaise: r.pfWagesPaise, flags: r.flags satisfies Flag[], assignmentId: c.assignmentId, structureId: c.structureId, grossSetupPaise: c.grossSetupPaise, rates: c.used.map((u) => ({ key: u.key, state: u.state, confidence: u.confidence, source: u.source, value: u.value, overridden: u.overridden })) };
  const values = {
    calendarDays: c.days.calendarDays, paidHalfDays: c.days.calendarDays * 2 - c.days.unpaidHalfDays, unpaidHalfDays: c.days.unpaidHalfDays, unmarkedDays: c.days.unmarkedDays,
    hours: c.days.hours == null ? null : String(c.days.hours), grossPaise: r.grossPaise, deductionsPaise: r.deductionsPaise, employerPaise: r.employerPaise, netPaise: r.netPaise, snapshot,
    ...(extra.skippedReason !== undefined ? { skippedReason: extra.skippedReason } : {}),
  };
  const [item] = await tx.insert(payItems).values({ schoolId, runId, userId: c.userId, ...values }).onConflictDoUpdate({ target: [payItems.runId, payItems.userId], set: values }).returning({ id: payItems.id });
  await tx.delete(payLines).where(and(eq(payLines.itemId, item!.id), eq(payLines.manual, false)));
  const fresh = r.lines.filter((l) => !l.manual && (l.amountPaise > 0 || l.needsInput));
  if (fresh.length) await tx.insert(payLines).values(fresh.map((l) => ({ schoolId, itemId: item!.id, kind: l.kind, code: l.code, label: l.label, amountPaise: l.amountPaise, manual: false, refId: l.refId ?? null, note: l.note ?? null, sort: l.sort })));
  return item!.id;
}

/** Run totals from the stored items and lines, with the PF admin minimum for the whole school. */
export async function refreshTotals(env: CalcEnv, runId: string): Promise<Record<string, number>> {
  const { tx } = env;
  const [run] = await tx.select().from(payRuns).where(eq(payRuns.id, runId));
  const items = await tx.select().from(payItems).where(eq(payItems.runId, runId));
  const live = items.filter((i) => !i.skippedReason);
  const sums = (await tx.select({ code: payLines.code, kind: payLines.kind, v: sql<string>`sum(${payLines.amountPaise})` }).from(payLines).innerJoin(payItems, eq(payItems.id, payLines.itemId))
    .where(and(eq(payItems.runId, runId), sql`${payItems.skippedReason} is null`)).groupBy(payLines.code, payLines.kind));
  const t: Record<string, number> = { people: live.length, skipped: items.length - live.length, gross: 0, deductions: 0, employer: 0, net: 0, claims: 0 };
  for (const i of live) { t.gross! += Number(i.grossPaise); t.deductions! += Number(i.deductionsPaise); t.employer! += Number(i.employerPaise); t.net! += Number(i.netPaise); }
  for (const s of sums) {
    if (s.code === "claim") t.claims! += Number(s.v);
    if (s.code && (STATUTORY_EMPLOYER.includes(s.code) || ["pf_employee", "esi_employee", "pt", "lwf_employee", "tds", "loan"].includes(s.code))) t[`c_${s.code}`] = Number(s.v);
  }
  const min = env.book.resolve<number>("pf_admin_min", run!.month)?.value ?? 0;
  const admin = t.c_pf_admin ?? 0;
  t.pfAdminTopUp = admin > 0 && admin < min ? min - admin : 0;
  t.employer! += t.pfAdminTopUp;
  await tx.update(payRuns).set({ totals: t }).where(eq(payRuns.id, runId));
  return t;
}

/** Every rate used by a run's items, one row per rate. */
export function ratesOf(items: ItemRow[]): Record<string, unknown>[] {
  const seen = new Map<string, Record<string, unknown>>();
  for (const i of items) for (const r of ((i.snapshot as { rates?: Record<string, unknown>[] }).rates ?? [])) seen.set(`${r.key}|${r.state ?? ""}|${String(r.source)}`, r);
  return [...seen.values()];
}
