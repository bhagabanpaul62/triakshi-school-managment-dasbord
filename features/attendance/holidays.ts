// The one reader of attendance_holidays and the one place that knows Sundays. Everything that asks "is the school open?" goes through here.
import { and, eq, gte, lte, ne } from "drizzle-orm";
import type { Tx } from "@smw/db";
import type { HolidayKind } from "./constants";
import { attendanceHolidays } from "./schema";
import { addDays, isSunday } from "./stats";

/** Staff, or the students of a class (null: students in general, so a class-only closure does not apply). */
export type Who = { staff: true } | { classId: string | null };
/** Why a day is closed. "sunday" is the weekly off. */
export type Closure = { name: string; kind: HolidayKind | "sunday" };
export type HolidayRow = Pick<typeof attendanceHolidays.$inferSelect, "date" | "name" | "kind" | "appliesTo" | "classIds">;

/** Does this row concern `who`? Staff are off only for "all"; students for "all" and "students"; a class for its own closures. */
export function concerns(row: Pick<HolidayRow, "appliesTo" | "classIds">, who: Who): boolean {
  if ("staff" in who) return row.appliesTo === "all";
  return row.appliesTo !== "classes" || (who.classId !== null && row.classIds.includes(who.classId));
}

/**
 * The closed days between `from` and `to` for one kind of person. Sundays are closed unless a "working" row
 * opens them for that person; a "working" row never closes a day.
 */
export function closedFrom(rows: HolidayRow[], from: string, to: string, who: Who): Map<string, Closure> {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out = new Map<string, Closure>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const r = byDate.get(d);
    if (isSunday(d)) { if (!(r?.kind === "working" && concerns(r, who))) out.set(d, { name: "Sunday", kind: "sunday" }); }
    else if (r && r.kind !== "working" && concerns(r, who)) out.set(d, { name: r.name, kind: r.kind });
  }
  return out;
}

const between = (from: string, to: string) => and(gte(attendanceHolidays.date, from), lte(attendanceHolidays.date, to));
const cols = { date: attendanceHolidays.date, name: attendanceHolidays.name, kind: attendanceHolidays.kind, appliesTo: attendanceHolidays.appliesTo, classIds: attendanceHolidays.classIds };

export async function closedDays(tx: Tx, from: string, to: string, who: Who): Promise<Map<string, Closure>> {
  return closedFrom(await tx.select(cols).from(attendanceHolidays).where(between(from, to)), from, to, who);
}

/** Just the dates, for the leave and pay arithmetic. */
export async function closedSet(tx: Tx, from: string, to: string, who: Who): Promise<Set<string>> {
  return new Set((await closedDays(tx, from, to, who)).keys());
}

/** Why `date` is closed for `who`, or null when it is open. */
export async function isClosed(tx: Tx, date: string, who: Who): Promise<Closure | null> {
  return (await closedDays(tx, date, date, who)).get(date) ?? null;
}

/** Sundays a "working" row opens for somebody. */
export async function openSundays(tx: Tx, from: string, to: string): Promise<string[]> {
  const rows = await tx.select({ date: attendanceHolidays.date }).from(attendanceHolidays).where(and(between(from, to), eq(attendanceHolidays.kind, "working")));
  return rows.map((r) => r.date).filter(isSunday).sort();
}

/** Classes a closure of "chosen classes" shuts on `date` (for lists of sections). */
export async function closedClassIds(tx: Tx, date: string): Promise<Set<string>> {
  const rows = await tx.select({ ids: attendanceHolidays.classIds }).from(attendanceHolidays)
    .where(and(eq(attendanceHolidays.date, date), eq(attendanceHolidays.appliesTo, "classes"), ne(attendanceHolidays.kind, "working")));
  return new Set(rows.flatMap((r) => r.ids));
}

/** What a register or calendar shows for each day: the weekly off and the named holiday are told apart. */
export const dayLook = (closed: Map<string, Closure>, date: string) => {
  const c = closed.get(date);
  return { sunday: c?.kind === "sunday", holiday: c && c.kind !== "sunday" ? c.name : null };
};

// ---------- working days in a school year ----------

/** The least days a school must teach in a year (RTE): classes 1 to 5 and 6 to 8. */
export const BANDS = [
  { key: "primary", label: "Classes 1 to 5", from: 1, to: 5, minimum: 200 },
  { key: "upper", label: "Classes 6 to 8", from: 6, to: 8, minimum: 220 },
] as const;

export type BandReport = { key: string; label: string; minimum: number; terms: { name: string; days: number }[]; year: number; short: boolean };

const countOpen = (rows: HolidayRow[], from: string, to: string, who: Who) => {
  if (to < from) return 0;
  let days = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) days++;
  return days - closedFrom(rows, from, to, who).size;
};

/**
 * Open days per term and for the year, for each band that has classes. A band counts as its weakest class, because a
 * closure of chosen classes costs those classes teaching days. Terms are cut to the year.
 */
export function workingDayReport(rows: HolidayRow[], year: { startsOn: string; endsOn: string }, terms: { name: string; startsOn: string; endsOn: string }[], classes: { id: string; grade: number }[]): BandReport[] {
  return BANDS.flatMap((b) => {
    const mine = classes.filter((c) => c.grade >= b.from && c.grade <= b.to);
    if (!mine.length) return [];
    const least = (from: string, to: string) => Math.min(...mine.map((c) => countOpen(rows, from, to, { classId: c.id })));
    const days = least(year.startsOn, year.endsOn);
    return [{
      key: b.key, label: b.label, minimum: b.minimum, year: days, short: days < b.minimum,
      terms: terms.map((t) => ({ name: t.name, days: least(t.startsOn < year.startsOn ? year.startsOn : t.startsOn, t.endsOn > year.endsOn ? year.endsOn : t.endsOn) })),
    }];
  });
}

// ---------- the ready list of national days ----------

/** Days that fall on the same date every year. The school ticks the ones it keeps: nothing is added on its own. */
export const FIXED_NATIONAL_DAYS = [
  { name: "Republic Day", month: 1, day: 26 }, { name: "Independence Day", month: 8, day: 15 }, { name: "Gandhi Jayanti", month: 10, day: 2 },
] as const;

/** Each fixed day as it falls inside the year (a school year runs across New Year, so 26 Jan is in the year that began the April before). */
export function nationalDaysIn(year: { startsOn: string; endsOn: string }): { name: string; date: string }[] {
  const startYear = Number(year.startsOn.slice(0, 4));
  return FIXED_NATIONAL_DAYS.flatMap((n) => [startYear, startYear + 1].map((y) => ({ name: n.name, date: `${y}-${String(n.month).padStart(2, "0")}-${String(n.day).padStart(2, "0")}` })))
    .filter((n) => n.date >= year.startsOn && n.date <= year.endsOn).sort((a, b) => a.date.localeCompare(b.date));
}
