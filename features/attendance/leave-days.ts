// Pure leave arithmetic: working days, leave years, pro-rata. No database, safe for client components.
import { addDays, isSunday } from "./stats";

/** Days between `from` and `to` (both included) that are neither a Sunday nor a holiday. */
export function workingDays(from: string, to: string, holidays: ReadonlySet<string>): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!isSunday(d) && !holidays.has(d)) days.push(d);
  return days;
}

/** First day of the leave year that holds `day`; the year starts on the 1st of `startMonth`. */
export function leaveYearStart(day: string, startMonth: number): string {
  const [y, m] = day.split("-").map(Number) as [number, number];
  return `${m >= startMonth ? y : y - 1}-${String(startMonth).padStart(2, "0")}-01`;
}

/** The last day of the leave year that starts on `start`. */
export function leaveYearEnd(start: string): string {
  const [y, m] = start.split("-").map(Number) as [number, number];
  return addDays(`${y + 1}-${String(m).padStart(2, "0")}-01`, -1);
}

/** A joiner gets the months of the leave year from the joining month on. No joining date means a full year. */
export function proRataHalfDays(yearly: number, joiningDate: string | null, yearStart: string): number {
  if (!joiningDate || joiningDate <= yearStart) return yearly;
  if (joiningDate > leaveYearEnd(yearStart)) return 0;
  const [ys, ms] = yearStart.split("-").map(Number) as [number, number];
  const [yj, mj] = joiningDate.split("-").map(Number) as [number, number];
  const months = 12 - ((yj - ys) * 12 + (mj - ms));
  return Math.round((yearly * months) / 12);
}

/** Half-days one leave day uses. */
export const halfDaysOfDay = (half: string | null | undefined) => (half ? 1 : 2);

/** "1.5" from 3 half-days. */
export const fmtDays = (halfDays: number) => String(halfDays / 2);

/** The leave year ("YYYY-MM-01" start) of a month "YYYY-MM". */
export const monthKey = (day: string) => day.slice(0, 7);
