import { and, asc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";
import { NotFoundError, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import { users, type Tx } from "@smw/db";
import attendanceFeature from "./feature";
import { leaveAdjustInput, leavePreviewInput } from "./inputs";
import { closedSet } from "./holidays";
import { fmtDays, halfDaysOfDay, workingDays } from "./leave-days";
import { balanceHalfDays, ensureCredit, ensureTypes, heldHalfDays, lockPerson, requestMonths, yearOf, yearsNeeded, type LeaveType, type Month } from "./leave-ledger";
import { leaveLedger, leaveRequests, leaveTypes } from "./schema";
import { monthDays as datesOf, todayIST } from "./stats";

type Perm = keyof typeof attendanceFeature.permissions;

export type Plan = {
  type: LeaveType; days: string[]; halfDays: number; months: Month[];
  /** Working days of the dates the person picked that the balance covers, and the rest. */
  paidDays: string[]; unpaidDays: string[];
  left: number; held: number; after: number; short: number; needsFile: boolean;
};
export type Preview = {
  workingDays: number; halfDays: number; paid: boolean; typeName: string; left: number; pending: number; after: number;
  short: number; paidHalfDays: number; unpaidHalfDays: number; unpaidTypeName: string | null; needsFile: boolean; needsFileAfterDays: number | null;
};
export type BalanceRow = { typeId: string; code: string; name: string; paid: boolean; entitled: number; used: number; pending: number; left: number };

/** Balances, the apply preview, manual adjustment and the "who is away" calendar. */
export class LeaveBalanceService extends SchoolService<Perm> {
  protected feature = attendanceFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** The first active unpaid type: where days beyond a balance can go. */
  static async unpaidType(tx: Tx): Promise<LeaveType | null> {
    const [t] = await tx.select().from(leaveTypes).where(and(eq(leaveTypes.paid, false), eq(leaveTypes.isActive, true))).orderBy(asc(leaveTypes.sort)).limit(1);
    return t ?? null;
  }

  /** Work out a request: its working days, half-days, what the balance covers and what it does not. Shared by preview, apply and edit. */
  static async plan(tx: Tx, userId: string, data: { typeId: string; fromDate: string; toDate: string; halfDay?: string }, exceptId?: string): Promise<Plan> {
    const [type] = await tx.select().from(leaveTypes).where(eq(leaveTypes.id, data.typeId)).limit(1);
    if (!type || !type.isActive) throw new ValidationError({ typeId: "Pick a leave type" });
    if (data.halfDay) {
      if (data.fromDate !== data.toDate) throw new ValidationError({ halfDay: "A half day is for one day only" });
      if (!type.halfDayAllowed) throw new ValidationError({ halfDay: `${type.name} leave cannot be taken as a half day` });
    }
    const days = workingDays(data.fromDate, data.toDate, await closedSet(tx, data.fromDate, data.toDate, { staff: true }));
    if (days.length === 0) throw new ValidationError({ fromDate: "Every one of these days is a Sunday or a holiday" });
    const months = await requestMonths(tx, { fromDate: data.fromDate, toDate: data.toDate, halfDay: data.halfDay ?? null });
    const halfDays = days.length * halfDaysOfDay(data.halfDay);
    const needsFile = type.needsFileAfterDays != null && days.length > type.needsFileAfterDays;
    if (!type.paid) return { type, days, halfDays, months, paidDays: [], unpaidDays: [], left: 0, held: 0, after: 0, short: 0, needsFile };

    await lockPerson(tx, userId, type.id);
    const years = await yearsNeeded(tx, userId, type, months, { withHeld: true, exceptId });
    const remaining = new Map(years.map((y) => [y.start, y.avail]));
    const paidDays: string[] = [];
    for (const d of days) {
      const y = (await yearOf(tx, d)).start, step = halfDaysOfDay(data.halfDay), have = remaining.get(y) ?? 0;
      if (have < step) break;
      remaining.set(y, have - step);
      paidDays.push(d);
    }
    const first = await yearOf(tx, days[0]!);
    const [left, held] = [await balanceHalfDays(tx, userId, type.id, first.start, first.end), await heldHalfDays(tx, userId, type.id, first.start, first.end, exceptId)];
    return { type, days, halfDays, months, paidDays, unpaidDays: days.slice(paidDays.length), left, held, after: left - held - halfDays, short: (days.length - paidDays.length) * halfDaysOfDay(data.halfDay), needsFile };
  }

  /** Live numbers for the apply form. */
  async preview(input: unknown): Promise<Preview> {
    const data = this.parse(leavePreviewInput, input);
    if (!data.typeId) throw new ValidationError({ typeId: "Pick a leave type" });
    return this.write("leave", async (tx) => {
      await ensureCredit(tx, this.ctx.schoolId, todayIST(), this.ctx.userId);
      const p = await LeaveBalanceService.plan(tx, this.ctx.userId, { ...data, typeId: data.typeId! });
      const unpaid = p.short ? await LeaveBalanceService.unpaidType(tx) : null;
      return {
        workingDays: p.days.length, halfDays: p.halfDays, paid: p.type.paid, typeName: p.type.name, left: p.left, pending: p.held, after: p.after, short: p.short,
        paidHalfDays: p.halfDays - p.short, unpaidHalfDays: p.short, unpaidTypeName: unpaid?.name ?? null, needsFile: p.needsFile, needsFileAfterDays: p.type.needsFileAfterDays,
      };
    });
  }

  /** Your balances this leave year, one row per active type with a balance, a limit or any use. */
  async mine(): Promise<BalanceRow[]> {
    return this.write("leave", async (tx) => {
      if (this.ctx.role === "student") return [];
      await ensureCredit(tx, this.ctx.schoolId, todayIST(), this.ctx.userId);
      const { start, end } = await yearOf(tx, todayIST());
      return this.rowsFor(tx, [this.ctx.userId], start, end).then((m) => m.get(this.ctx.userId) ?? []);
    });
  }

  /** Balances for each of `userIds`, from the ledger plus waiting requests. */
  private async rowsFor(tx: Tx, userIds: string[], start: string, end: string): Promise<Map<string, BalanceRow[]>> {
    const [types, sums, pending] = await Promise.all([
      tx.select().from(leaveTypes).where(eq(leaveTypes.isActive, true)).orderBy(asc(leaveTypes.sort)),
      tx.select({ userId: leaveLedger.userId, typeId: leaveLedger.typeId, kind: leaveLedger.kind, n: sql<number>`sum(${leaveLedger.halfDays})::int` }).from(leaveLedger)
        .where(and(inArray(leaveLedger.userId, userIds), gte(leaveLedger.date, start), lte(leaveLedger.date, end))).groupBy(leaveLedger.userId, leaveLedger.typeId, leaveLedger.kind),
      tx.select().from(leaveRequests).where(and(inArray(leaveRequests.userId, userIds), eq(leaveRequests.status, "pending"), lte(leaveRequests.fromDate, end), gte(leaveRequests.toDate, start))),
    ]);
    const held = new Map<string, number>();
    for (const p of pending) if (p.typeId) for (const m of await requestMonths(tx, p)) if (m.first >= start && m.first <= end) held.set(`${p.userId}:${p.typeId}`, (held.get(`${p.userId}:${p.typeId}`) ?? 0) + m.halfDays);
    const out = new Map<string, BalanceRow[]>();
    for (const id of userIds) {
      out.set(id, types.map((t) => {
        const mine = sums.filter((s) => s.userId === id && s.typeId === t.id);
        const sum = (kinds: string[]) => mine.filter((s) => kinds.includes(s.kind)).reduce((a, s) => a + s.n, 0);
        const used = 0 - sum(["used", "reversed", "encash"]), entitled = sum(["credit", "carry", "adjust"]);
        return { typeId: t.id, code: t.code, name: t.name, paid: t.paid, entitled, used, pending: held.get(`${id}:${t.id}`) ?? 0, left: entitled - used };
      }));
    }
    return out;
  }

  /** Staff by leave type for the admin table; `year` is a day inside the leave year wanted (today by default). */
  async table(year?: string) {
    return this.read("manage", async (tx) => {
      await ensureTypes(tx, this.ctx.schoolId);
      const { start, end } = await yearOf(tx, year ?? todayIST());
      const people = await tx.select({ id: users.id, name: users.name, role: users.role }).from(users)
        .where(and(notInArray(users.role, ["student", "parent"]), inArray(users.status, ["active", "invited"]))).orderBy(asc(users.name));
      const rows = people.length ? await this.rowsFor(tx, people.map((p) => p.id), start, end) : new Map<string, BalanceRow[]>();
      const types = await tx.select().from(leaveTypes).where(eq(leaveTypes.isActive, true)).orderBy(asc(leaveTypes.sort));
      return { start, end, types, people: people.map((p) => ({ ...p, balances: rows.get(p.id) ?? [] })) };
    });
  }

  async csv(year?: string) {
    const t = await this.table(year);
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
    const head = ["Name", ...t.types.flatMap((x) => [`${x.name} credited`, `${x.name} used`, `${x.name} left`])];
    const body = t.people.map((p) => [p.name, ...p.balances.flatMap((b) => [fmtDays(b.entitled), fmtDays(b.used), fmtDays(b.left)])]);
    return { text: [head, ...body].map((r) => r.map((c) => esc(String(c))).join(",")).join("\n"), fileName: `leave-balances-${t.start}.csv` };
  }

  /** Add or take away days by hand, with a reason. The balance may not go below zero. */
  async adjust(input: unknown) {
    this.authorize("manage", "write");
    const data = this.parse(leaveAdjustInput, input);
    return this.write("manage", async (tx) => {
      const [[person], [type]] = await Promise.all([
        tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.id, data.userId), notInArray(users.role, ["student", "parent"]))).limit(1),
        tx.select().from(leaveTypes).where(eq(leaveTypes.id, data.typeId)).limit(1),
      ]);
      if (!person) throw new NotFoundError("Staff member");
      if (!type) throw new NotFoundError("Leave type");
      const today = todayIST(), { start, end } = await yearOf(tx, today);
      await lockPerson(tx, person.id, type.id);
      const halfDays = Math.round(data.days * 2);
      if ((await balanceHalfDays(tx, person.id, type.id, start, end)) + halfDays < 0) throw new ValidationError({ days: "That would take the balance below zero" });
      await tx.insert(leaveLedger).values({ schoolId: this.ctx.schoolId, userId: person.id, typeId: type.id, date: today, halfDays, kind: "adjust", note: data.reason });
      return { person: person.name, type: type.name, halfDays, reason: data.reason };
    }, (o) => ({ action: "adjust", entity: "Leave balance", summary: `${o.halfDays > 0 ? "Added" : "Took"} ${fmtDays(Math.abs(o.halfDays))} days of ${o.type} for ${o.person}: ${o.reason}`, meta: { halfDays: o.halfDays } }));
  }

  /** Approved staff leave and waiting requests that touch a month, for the who-is-away calendar. No reasons are shown. */
  async calendar(month: string) {
    const days = datesOf(month);
    return this.read("approve", async (tx) => {
      const rows = await tx.select({ id: leaveRequests.id, name: users.name, from: leaveRequests.fromDate, to: leaveRequests.toDate, status: leaveRequests.status, halfDay: leaveRequests.halfDay })
        .from(leaveRequests).innerJoin(users, eq(users.id, leaveRequests.userId))
        .where(and(eq(leaveRequests.kind, "staff"), inArray(leaveRequests.status, ["approved", "pending"]), lte(leaveRequests.fromDate, days.at(-1)!), gte(leaveRequests.toDate, days[0]!)))
        .orderBy(asc(users.name), asc(leaveRequests.fromDate));
      const closed = await closedSet(tx, days[0]!, days.at(-1)!, { staff: true });
      return { days: days.map((date) => ({ date, off: closed.has(date) })), rows };
    });
  }
}
