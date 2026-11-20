// Framework-free date and percentage helpers shared by the services, the seed and the pages.
import type { AttendanceStatus } from "./constants";

export type Counts = Record<AttendanceStatus, number> & { total: number };

/** Today's date in India as "YYYY-MM-DD". */
export const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

const utc = (d: string) => new Date(`${d}T00:00:00Z`);
export const addDays = (d: string, n: number) => { const x = utc(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const isSunday = (d: string) => utc(d).getUTCDay() === 0;
export const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && utc(d).toISOString().slice(0, 10) === d;

/** Every date of a "YYYY-MM" month. */
export function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** 1 April of the school year a date falls in. */
export function schoolYearStart(d: string): string {
  const [y, m] = d.split("-").map(Number) as [number, number];
  return `${m < 4 ? y - 1 : y}-04-01`;
}

export function tally(statuses: Iterable<string>): Counts {
  const c: Counts = { present: 0, absent: 0, late: 0, leave: 0, half_day: 0, total: 0 };
  for (const s of statuses) { if (s in c) { c[s as AttendanceStatus]++; c.total++; } }
  return c;
}

/**
 * Attendance %: present and late count fully, half day counts half, leave is excused and left out.
 * Null when there is nothing to measure. One decimal.
 */
export function attendancePercent(c: Pick<Counts, "present" | "late" | "absent" | "half_day">): number | null {
  const days = c.present + c.late + c.absent + c.half_day;
  return days === 0 ? null : Math.round(((c.present + c.late + c.half_day * 0.5) / days) * 1000) / 10;
}

export function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const item of items) { const k = key(item); const g = out.get(k); if (g) g.push(item); else out.set(k, [item]); }
  return out;
}

/** Counts from grouped `{ status, n }` rows (a SQL GROUP BY status). */
export const countsOf = (rows: { status: string; n: number | string }[]): Counts =>
  tally(rows.flatMap((r) => Array<string>(Number(r.n)).fill(r.status)));

/**
 * A day's status from its periods: present when present or late in at least `pct`% of the periods that count.
 * Leave periods are excused (left out of both sides); a day of only leave is leave.
 */
export function rollupStatus(statuses: string[], pct: number): "present" | "absent" | "leave" {
  const counted = statuses.filter((s) => s !== "leave");
  if (counted.length === 0) return "leave";
  const here = counted.filter((s) => s === "present" || s === "late").length;
  return here * 100 >= pct * counted.length ? "present" : "absent";
}
