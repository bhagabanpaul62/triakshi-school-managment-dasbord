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
