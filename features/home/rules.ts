// Pure helpers for the home pages: IST dates and clock, greeting, "now / next" period, attendance tone. No database, no React.

const IST = "Asia/Kolkata";

/** Today in India as "YYYY-MM-DD". */
export const todayIST = (now: Date = new Date()) => now.toLocaleDateString("en-CA", { timeZone: IST });

/** "HH:MM" in India, 24-hour (the format the bell schedule stores). */
export function clockIST(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

export type TimeOfDay = "morning" | "afternoon" | "evening";
export function timeOfDay(now: Date = new Date()): TimeOfDay {
  const h = Number(clockIST(now).slice(0, 2));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** "Good morning, Anita". */
export const greeting = (name: string, now: Date = new Date()) => `Good ${timeOfDay(now)}, ${firstName(name)}`;

/** "Tuesday, 19 Nov". */
export function dayLabel(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-IN", { timeZone: IST, weekday: "long", day: "numeric", month: "short" }).formatToParts(now);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("weekday")}, ${get("day")} ${get("month")}`;
}

/** "9:05 am" from "09:05". */
export function clock12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export const isSunday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0;
export const monthStart = (date: string) => `${date.slice(0, 7)}-01`;

export type PeriodState = "done" | "now" | "next" | "later";

/**
 * Mark each timetable row relative to `hhmm`: the one running now, the first one still to come, and the rest.
 * Breaks never count as "now" or "next" (nobody teaches in them), but stay in the list so the day reads in order.
 */
export function markPeriods<T extends { startsAt: string; endsAt: string; isBreak: boolean }>(rows: T[], hhmm: string): (T & { state: PeriodState })[] {
  let nextTaken = false;
  return rows.map((r) => {
    if (r.endsAt <= hhmm) return { ...r, state: "done" as const };
    if (!r.isBreak && r.startsAt <= hhmm) return { ...r, state: "now" as const };
    if (!r.isBreak && !nextTaken) { nextTaken = true; return { ...r, state: "next" as const }; }
    return { ...r, state: "later" as const };
  });
}

/** Attendance: below 75% is the school's defaulter line. */
export const attendanceTone = (pct: number): "success" | "warning" | "danger" => (pct >= 90 ? "success" : pct >= 75 ? "warning" : "danger");

/** Plan usage: warning from 90% (same threshold as the admission cap), danger once the plan is full. */
export const planTone = (active: number, cap: number): "info" | "warning" | "danger" =>
  cap > 0 && active >= cap ? "danger" : cap > 0 && active >= cap * 0.9 ? "warning" : "info";

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- dates, change and birthdays (pure) ----------

/** "YYYY-MM-DD" plus `n` days (calendar arithmetic, no time zone involved). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", timeZone: "UTC" });
const dayMonth = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** "Monday" for a day within the week, "Monday, 30 Nov" further out. */
export function dayWords(date: string, today: string): string {
  const gap = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return gap > 0 && gap < 7 ? weekdayOf(date) : `${weekdayOf(date)}, ${dayMonth(date)}`;
}

/** The first open day after `today` among closed days `closed` (a set of "YYYY-MM-DD"), looking `horizon` days ahead; null when all are closed. */
export function nextOpenDay(closed: ReadonlySet<string>, today: string, horizon = 30): string | null {
  for (let i = 1; i <= horizon; i++) { const d = addDays(today, i); if (!closed.has(d)) return d; }
  return null;
}

/** How a number moved. `tone` is about good or bad, not about up or down. */
export interface Change { text: string; direction: "up" | "down" | "flat"; tone: "success" | "danger" | "default" }

/** Percentage change of `current` against `previous` (money, counts). Null when there is nothing to compare with. `lowerIsBetter` flips the colour. */
export function changePct(current: number, previous: number | null | undefined, lowerIsBetter = false): Change | null {
  if (previous == null || previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return { text: "same", direction: "flat", tone: "default" };
  const up = pct > 0;
  return { text: `${Math.abs(pct)}%`, direction: up ? "up" : "down", tone: up !== lowerIsBetter ? "success" : "danger" };
}

/** Change in percentage points (attendance), worked out from the two numbers as shown (whole percents), so 75 against 88 reads "13 pts". Null with nothing to compare. */
export function changePoints(current: number, previous: number | null | undefined): Change | null {
  if (previous == null) return null;
  const pts = Math.round(current) - Math.round(previous);
  if (pts === 0) return { text: "same", direction: "flat", tone: "default" };
  return { text: `${Math.abs(pts)} ${Math.abs(pts) === 1 ? "pt" : "pts"}`, direction: pts > 0 ? "up" : "down", tone: pts > 0 ? "success" : "danger" };
}

/** Average of the same weekday over the last `weeks` weeks before `today`, from days that were marked. Null when none was. */
export function sameWeekdayAverage(points: { date: string; pct: number }[], today: string, weeks = 4): number | null {
  const want = new Set(Array.from({ length: weeks }, (_, i) => addDays(today, -7 * (i + 1))));
  const hit = points.filter((p) => want.has(p.date));
  return hit.length ? hit.reduce((s, p) => s + p.pct, 0) / hit.length : null;
}

/** Collected so far this month and over the same days of last month, from per-day totals (zero-filled or not). */
export function monthToDate(days: { key: string; paise: number }[], today: string): { thisMonth: number; lastMonthSame: number } {
  const month = today.slice(0, 7), dd = today.slice(8, 10);
  const last = addDays(`${month}-01`, -1).slice(0, 7);
  let thisMonth = 0, lastMonthSame = 0;
  for (const d of days) {
    if (d.key.startsWith(month) && d.key <= today) thisMonth += d.paise;
    else if (d.key.startsWith(last) && d.key.slice(8, 10) <= dd) lastMonthSame += d.paise;
  }
  return { thisMonth, lastMonthSame };
}

/** "MM-DD" of a day, the key birthdays match on. */
export const monthDayOf = (date: string) => date.slice(5, 10);

/** Whole years on `today` for someone born on `dob`. */
export function ageOn(dob: string, today: string): number {
  const years = Number(today.slice(0, 4)) - Number(dob.slice(0, 4));
  return monthDayOf(today) < monthDayOf(dob) ? years - 1 : years;
}

/** The receipt register for a span of days, the same rule as the money cards (live receipts, new money): the number and its list agree. */
export const receiptsHref = (from: string, to: string) => `/app/fees/receipts?period=custom&from=${from}&to=${to}`;
