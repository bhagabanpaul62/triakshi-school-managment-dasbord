// Leave ledger helpers that work inside any caller's transaction and check no permission. The services and leave-api.ts use them.
import { and, asc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";
import { schools, users, type Tx } from "@smw/db";
import { ValidationError } from "@smw/feature-kit";
import { DEFAULT_LEAVE_TYPES } from "./constants";
import { fmtDays, halfDaysOfDay, leaveYearEnd, leaveYearStart, monthKey, proRataHalfDays, workingDays } from "./leave-days";
import { closedSet } from "./holidays";
import { leaveLedger, leaveRequests, leaveTypes } from "./schema";
import { addDays } from "./stats";

export type LeaveType = typeof leaveTypes.$inferSelect;
type Request = typeof leaveRequests.$inferSelect;
export type Month = { month: string; first: string; halfDays: number };

export async function startMonth(tx: Tx): Promise<number> {
  const [s] = await tx.select({ m: schools.academicYearStartMonth }).from(schools).limit(1);
  return s?.m ?? 4;
}

export async function yearOf(tx: Tx, day: string) {
  const start = leaveYearStart(day, await startMonth(tx));
  return { start, end: leaveYearEnd(start) };
}

/** Types are made the first time anyone looks; a school that deleted them all gets the defaults back. */
export async function ensureTypes(tx: Tx, schoolId: string): Promise<void> {
  const [any] = await tx.select({ id: leaveTypes.id }).from(leaveTypes).limit(1);
  if (any) return;
  await tx.insert(leaveTypes).values(DEFAULT_LEAVE_TYPES.map((t) => ({ ...t, schoolId }))).onConflictDoNothing();
}

/** Two approvals or applications for the same person and type wait for each other, so the balance they read is current. */
export function lockPerson(tx: Tx, userId: string, typeId: string) {
  return tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId + ":" + typeId}))`);
}

export async function balanceHalfDays(tx: Tx, userId: string, typeId: string, start: string, end: string): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`coalesce(sum(${leaveLedger.halfDays}), 0)::int` }).from(leaveLedger)
    .where(and(eq(leaveLedger.userId, userId), eq(leaveLedger.typeId, typeId), gte(leaveLedger.date, start), lte(leaveLedger.date, end)));
  return r?.n ?? 0;
}

/** The working days of a request, as half-days per calendar month (a month never crosses a leave year). */
export async function requestMonths(tx: Tx, r: { fromDate: string; toDate: string; halfDay: string | null }): Promise<Month[]> {
  const days = workingDays(r.fromDate, r.toDate, await closedSet(tx, r.fromDate, r.toDate, { staff: true }));
  const by = new Map<string, Month>();
  for (const d of days) {
    const m = by.get(monthKey(d)) ?? { month: monthKey(d), first: d, halfDays: 0 };
    m.halfDays += halfDaysOfDay(r.halfDay);
    by.set(m.month, m);
  }
  return [...by.values()];
}

/** Half-days of one type that waiting requests already hold in a leave year. */
export async function heldHalfDays(tx: Tx, userId: string, typeId: string, start: string, end: string, exceptId?: string): Promise<number> {
  const pending = await tx.select().from(leaveRequests).where(and(eq(leaveRequests.userId, userId), eq(leaveRequests.typeId, typeId), eq(leaveRequests.status, "pending"), lte(leaveRequests.fromDate, end), gte(leaveRequests.toDate, start)));
  let held = 0;
  for (const p of pending) if (p.id !== exceptId) for (const m of await requestMonths(tx, p)) if (m.first >= start && m.first <= end) held += m.halfDays;
  return held;
}

/** Used per leave year of a request, with what is available in each (balance, less other waiting requests when `withHeld`). */
export async function yearsNeeded(tx: Tx, userId: string, type: LeaveType, months: Month[], opts: { withHeld: boolean; exceptId?: string }) {
  const per = new Map<string, number>();
  for (const m of months) { const y = (await yearOf(tx, m.first)).start; per.set(y, (per.get(y) ?? 0) + m.halfDays); }
  const out: { start: string; end: string; need: number; avail: number }[] = [];
  for (const [start, need] of [...per].sort()) {
    const end = leaveYearEnd(start);
    const avail = (await balanceHalfDays(tx, userId, type.id, start, end)) - (opts.withHeld ? await heldHalfDays(tx, userId, type.id, start, end, opts.exceptId) : 0);
    out.push({ start, end, need, avail });
  }
  return out;
}

/** Refuse a paid-type request that needs more than is left. Caller holds lockPerson. */
export async function assertBalance(tx: Tx, userId: string, type: LeaveType, months: Month[], opts: { withHeld: boolean; exceptId?: string }) {
  if (!type.paid) return;
  const short = (await yearsNeeded(tx, userId, type, months, opts)).find((y) => y.need > y.avail);
  if (short) throw new ValidationError({ typeId: `Not enough ${type.name} leave: ${fmtDays(Math.max(0, short.avail))} days left, ${fmtDays(short.need)} needed` });
}

/** Approval: one `used` row per month of the request. */
export async function writeUsed(tx: Tx, schoolId: string, r: Request, months: Month[]) {
  if (!r.userId || !r.typeId || months.length === 0) return;
  await tx.insert(leaveLedger).values(months.map((m) => ({ schoolId, userId: r.userId!, typeId: r.typeId!, date: m.first, halfDays: -m.halfDays, kind: "used" as const, requestId: r.id, note: null })));
}

/** Reversal: give back whatever the request still holds (used rows net of earlier reversals). */
export async function writeReversed(tx: Tx, schoolId: string, r: Request) {
  if (!r.userId || !r.typeId) return;
  const net = await tx.select({ date: leaveLedger.date, n: sql<number>`sum(${leaveLedger.halfDays})::int` }).from(leaveLedger)
    .where(and(eq(leaveLedger.requestId, r.id), inArray(leaveLedger.kind, ["used", "reversed"]))).groupBy(leaveLedger.date);
  const open = net.filter((x) => x.n < 0);
  if (open.length) await tx.insert(leaveLedger).values(open.map((x) => ({ schoolId, userId: r.userId!, typeId: r.typeId!, date: x.date, halfDays: -x.n, kind: "reversed" as const, requestId: r.id, note: null })));
}

/** Joining dates by user, read by raw SQL because staff is another feature (a school without it has no table). */
export async function joiningDates(tx: Tx, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const [t] = [...(await tx.execute(sql`select to_regclass('staff_profiles') as t`))] as { t: string | null }[];
  if (!t?.t) return new Map();
  const ids = sql.join(userIds.map((i) => sql`${i}`), sql`, `);
  const rows = [...(await tx.execute(sql`select user_id as id, to_char(joining_date, 'YYYY-MM-DD') as d from staff_profiles where joining_date is not null and user_id in (${ids})`))] as { id: string; d: string }[];
  return new Map(rows.map((r) => [r.id, r.d]));
}

/**
 * Yearly credit and carry forward for the leave year that holds `today`, for everyone who is not a student or parent
 * (or just `userId`). Safe to run any number of times: a unique index on person, type, year and kind makes the rest no-ops.
 * A joiner gets the months from the joining month on. Carry is last year's balance, capped by the type.
 */
export async function ensureCredit(tx: Tx, schoolId: string, today: string, userId?: string): Promise<number> {
  await ensureTypes(tx, schoolId);
  const { start, end } = await yearOf(tx, today);
  const prevStart = leaveYearStart(addDays(start, -1), Number(start.slice(5, 7)));
  const [types, people] = await Promise.all([
    tx.select().from(leaveTypes).where(eq(leaveTypes.isActive, true)).orderBy(asc(leaveTypes.sort)),
    tx.select({ id: users.id }).from(users).where(and(notInArray(users.role, ["student", "parent"]), inArray(users.status, ["active", "invited"]), userId ? eq(users.id, userId) : undefined)),
  ]);
  const ids = people.map((p) => p.id);
  const earning = types.filter((t) => t.yearlyHalfDays > 0);
  if (ids.length === 0 || earning.length === 0) return 0;
  const [joined, prev] = await Promise.all([
    joiningDates(tx, ids),
    tx.select({ userId: leaveLedger.userId, typeId: leaveLedger.typeId, n: sql<number>`sum(${leaveLedger.halfDays})::int` }).from(leaveLedger)
      .where(and(gte(leaveLedger.date, prevStart), lte(leaveLedger.date, addDays(start, -1)), inArray(leaveLedger.userId, ids))).groupBy(leaveLedger.userId, leaveLedger.typeId),
  ]);
  const before = new Map(prev.map((p) => [`${p.userId}:${p.typeId}`, p.n]));
  const rows: (typeof leaveLedger.$inferInsert)[] = [];
  for (const id of ids) for (const t of earning) {
    const credit = proRataHalfDays(t.yearlyHalfDays, joined.get(id) ?? null, start);
    if (credit > 0) rows.push({ schoolId, userId: id, typeId: t.id, date: start, halfDays: credit, kind: "credit", note: `Leave year ${start} to ${end}` });
    const carry = Math.min(Math.max(before.get(`${id}:${t.id}`) ?? 0, 0), t.carryForwardHalfDays);
    if (carry > 0) rows.push({ schoolId, userId: id, typeId: t.id, date: start, halfDays: carry, kind: "carry", note: "Carried forward" });
  }
  if (rows.length === 0) return 0;
  return (await tx.insert(leaveLedger).values(rows).onConflictDoNothing().returning({ id: leaveLedger.id })).length;
}
