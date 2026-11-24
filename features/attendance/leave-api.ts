// What payroll reads from attendance and leave. Plain queries inside the caller's transaction, no permission check.
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { addDays, isSunday, monthDays as datesOf } from "./stats";
import { balanceHalfDays, holidaySet, joiningDates, yearOf } from "./leave-ledger";
import { halfDaysOfDay } from "./leave-days";
import { leaveRequests, leaveTypes, staffAttendance } from "./schema";

export type MonthDays = {
  calendarDays: number; sundays: number;
  /** Closed days that are not Sundays. */
  holidays: number;
  /** Working days inside the person's time with the school this month. */
  workingDays: number;
  /** Marked present; late days are counted apart (both are worked days). */
  present: number; lateDays: number;
  /** Half-day marks; the other half is in the leave or absent figures. */
  half: number;
  paidLeaveHalfDays: number; unpaidLeaveHalfDays: number;
  /** Whole days, with .5 for the missing half of a half day. */
  absentDays: number;
  /** Working days with no mark and no approved leave. */
  unmarkedDays: number;
};

const blank = (): MonthDays => ({ calendarDays: 0, sundays: 0, holidays: 0, workingDays: 0, present: 0, lateDays: 0, half: 0, paidLeaveHalfDays: 0, unpaidLeaveHalfDays: 0, absentDays: 0, unmarkedDays: 0 });

/**
 * One month for each person. Days before the joining date and after the leaving date are not counted. A person whose login
 * is disabled counts up to `opts.leftOn[userId]`, or when no date is given, up to the last day marked (no guessing).
 * Leave that is approved but unmarked counts as leave; a leave day with no request, or with an old untyped one, is paid.
 */
export async function monthDays(tx: Tx, userIds: string[], month: string, opts: { leftOn?: Record<string, string> } = {}): Promise<Record<string, MonthDays>> {
  const dates = datesOf(month), first = dates[0]!, last = dates.at(-1)!;
  const out: Record<string, MonthDays> = {};
  if (userIds.length === 0) return out;
  const [holidays, marks, requests, joined, people] = await Promise.all([
    holidaySet(tx, first, last),
    tx.select().from(staffAttendance).where(and(inArray(staffAttendance.userId, userIds), gte(staffAttendance.date, first), lte(staffAttendance.date, last))),
    tx.select({ r: leaveRequests, paid: leaveTypes.paid }).from(leaveRequests).leftJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.typeId))
      .where(and(inArray(leaveRequests.userId, userIds), eq(leaveRequests.kind, "staff"), eq(leaveRequests.status, "approved"), lte(leaveRequests.fromDate, last), gte(leaveRequests.toDate, first))),
    joiningDates(tx, userIds),
    tx.select({ id: users.id, status: users.status }).from(users).where(inArray(users.id, userIds)),
  ]);
  const mark = new Map(marks.map((m) => [`${m.userId}|${m.date}`, m.status]));
  const away = new Map<string, { paid: boolean; half: boolean }>();
  for (const { r, paid } of requests) for (let d = r.fromDate < first ? first : r.fromDate; d <= r.toDate && d <= last; d = addDays(d, 1)) away.set(`${r.userId}|${d}`, { paid: paid ?? true, half: !!r.halfDay });
  const status = new Map(people.map((p) => [p.id, p.status]));
  const sundays = dates.filter(isSunday).length;
  const closed = dates.filter((d) => holidays.has(d) && !isSunday(d)).length;

  for (const id of userIds) {
    const t = blank();
    t.calendarDays = dates.length; t.sundays = sundays; t.holidays = closed;
    const from = [first, joined.get(id) ?? first].sort().at(-1)!;
    const markedDays = marks.filter((m) => m.userId === id).map((m) => m.date).sort();
    const leftOn = opts.leftOn?.[id] ?? (status.get(id) === "disabled" ? markedDays.at(-1) ?? addDays(first, -1) : last);
    const to = leftOn < last ? leftOn : last;
    for (const d of dates) {
      if (d < from || d > to || isSunday(d) || holidays.has(d)) continue;
      t.workingDays++;
      const s = mark.get(`${id}|${d}`), a = away.get(`${id}|${d}`);
      const leave = (halfDays: number) => { if (a?.paid ?? true) t.paidLeaveHalfDays += halfDays; else t.unpaidLeaveHalfDays += halfDays; };
      if (s === "present") t.present++;
      else if (s === "late") t.lateDays++;
      else if (s === "absent") t.absentDays++;
      else if (s === "leave") leave(2);
      else if (s === "half_day") { t.half++; if (a) leave(1); else t.absentDays += 0.5; }
      else if (a) { if (a.half) { t.half++; leave(1); } else leave(halfDaysOfDay(null)); }
      else t.unmarkedDays++;
    }
    out[id] = t;
  }
  return out;
}

/** What leave `userId` could be paid out for on `day`: balance of every encashable type in that leave year. */
export async function encashable(tx: Tx, userId: string, day: string): Promise<{ typeId: string; code: string; name: string; halfDays: number }[]> {
  const { start, end } = await yearOf(tx, day);
  const types = await tx.select().from(leaveTypes).where(and(eq(leaveTypes.encashable, true), eq(leaveTypes.paid, true)));
  const out = [];
  for (const t of types) {
    const halfDays = await balanceHalfDays(tx, userId, t.id, start, end);
    if (halfDays > 0) out.push({ typeId: t.id, code: t.code, name: t.name, halfDays });
  }
  return out;
}
