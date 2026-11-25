// Pure date helpers. Schools run on Indian Standard Time, so "a day" always means a day in IST.
// No framework imports: used by the service, the seed and the calendar UI.
import { istDay, toIstInput } from "@smw/feature-kit/words";

const DAY_MS = 86_400_000;

/** "2026-11-18" or "2026-11-18T09:30" (IST wall time) to an instant. Null when it is not a date. */
export function parseIst(v: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?$/.exec(v.trim());
  const d = m ? new Date(`${m[1]}T${m[2] ?? "00:00"}:00+05:30`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}


export { istDay, toIstInput as toInputValue };

/** An all-day span covers whole IST days: start of the first day to the last instant of the last. */
export function allDaySpan(startsAt: Date, endsAt?: Date | null) {
  const first = parseIst(istDay(startsAt))!;
  const last = parseIst(istDay(endsAt ?? startsAt))!;
  return { startsAt: first, endsAt: new Date(Math.max(last.getTime(), first.getTime()) + DAY_MS - 1) };
}

/** [from, to) of a "YYYY-MM" month in IST. */
export function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: parseIst(`${ym}-01`)!, to: parseIst(`${next}-01`)! };
}

export const shiftMonth = (ym: string, by: number) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
export const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** Whole days from `a` to `b` ("YYYY-MM-DD"). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** The same day of a later month, or the last day of that month when it has no such day (31 Jan + 1 month = 28 Feb). */
export function addMonthsClamped(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m + n, 0));
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last.getUTCDate())).padStart(2, "0")}`;
}

/** Monday of the week that holds `ymd`. */
export const weekStart = (ymd: string) => addDays(ymd, -((new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7));

export type CalendarView = "agenda" | "month" | "week" | "year";
export const AGENDA_DAYS = 60;

/** The day range [from, to) of a view around `anchor` ("YYYY-MM-DD"), as days and as IST instants. Every view's query uses this. */
export function viewRange(view: CalendarView, anchor: string) {
  let from = anchor, to: string;
  if (view === "month") { from = `${anchor.slice(0, 7)}-01`; to = `${shiftMonth(anchor.slice(0, 7), 1)}-01`; }
  else if (view === "week") { from = weekStart(anchor); to = addDays(from, 7); }
  else if (view === "year") { from = `${anchor.slice(0, 4)}-01-01`; to = `${Number(anchor.slice(0, 4)) + 1}-01-01`; }
  else to = addDays(anchor, AGENDA_DAYS);
  return { fromDay: from, toDay: to, from: parseIst(from)!, to: parseIst(to)! };
}

/** Every IST day an item touches, capped at a year. A timed item that ends at midnight does not touch the next day. */
export function daysOf(startsAt: string | Date, endsAt: string | Date | null): string[] {
  const first = istDay(startsAt);
  const last = endsAt ? istDay(new Date(new Date(endsAt).getTime() - 1)) : first;
  const n = Math.min(Math.max(daysBetween(first, last < first ? first : last), 0), 365);
  return Array.from({ length: n + 1 }, (_, i) => addDays(first, i));
}
