// Pure helpers for the school week and the bell schedule. No dependencies, so server and client code can both import it.

/** Monday to Saturday: the Indian school week. `n` matches ISO weekday numbers stored in timetable_slots.day_of_week. */
export const DAYS = [
  { n: 1, name: "Monday", short: "Mon" },
  { n: 2, name: "Tuesday", short: "Tue" },
  { n: 3, name: "Wednesday", short: "Wed" },
  { n: 4, name: "Thursday", short: "Thu" },
  { n: 5, name: "Friday", short: "Fri" },
  { n: 6, name: "Saturday", short: "Sat" },
] as const;

export const dayName = (n: number) => DAYS.find((d) => d.n === n)?.name ?? "";

/** Weekday in India for an instant: 1 (Mon) to 6 (Sat), or null on Sunday. */
export function schoolDay(now: Date): number | null {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const d = ist.getUTCDay(); // 0 = Sunday
  return d === 0 ? null : d;
}

/** Calendar date in India for an instant, "YYYY-MM-DD". */
export const istDate = (now: Date) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const minutesOf = toMinutes;
export const addMinutes = (hhmm: string, mins: number) => toHhmm(toMinutes(hhmm) + mins);

/** "13:40" -> "1:40 pm". */
export function formatTime(hhmm: string): string {
  const h = Number(hhmm.slice(0, 2));
  return `${h % 12 || 12}:${hhmm.slice(3, 5)} ${h < 12 ? "am" : "pm"}`;
}

export const timeRange = (startsAt: string, endsAt: string) => `${formatTime(startsAt)} to ${formatTime(endsAt)}`;

export interface PeriodDraft { name: string; startsAt: string; endsAt: string; sortOrder: number; isBreak: boolean }

/** The standard day: 8 periods of 40 minutes from 8:00 with a 20-minute break after period 4. */
export function presetPeriods(start = "08:00", periodMins = 40, breakMins = 20, count = 8, breakAfter = 4): PeriodDraft[] {
  const out: PeriodDraft[] = [];
  let at = start;
  for (let i = 1; i <= count; i++) {
    out.push({ name: `Period ${i}`, startsAt: at, endsAt: addMinutes(at, periodMins), sortOrder: out.length + 1, isBreak: false });
    at = addMinutes(at, periodMins);
    if (i === breakAfter) {
      out.push({ name: "Break", startsAt: at, endsAt: addMinutes(at, breakMins), sortOrder: out.length + 1, isBreak: true });
      at = addMinutes(at, breakMins);
    }
  }
  return out;
}

/** Key of a cell in a timetable's `cells` map. */
export const cellKey = (day: number, periodId: string) => `${day}:${periodId}`;

/** Minutes since midnight in India for an instant. */
export function istMinutes(now: Date): number {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

/** The class in progress right now and the next one (today, else the next school day), from a timetable's cells. Breaks are skipped. */
export function nowAndNext<P extends { id: string; startsAt: string; endsAt: string; isBreak: boolean }, C>(
  periods: P[],
  cells: Record<string, C>,
  now: Date,
): { now: { day: number; period: P; cell: C } | null; next: { day: number; period: P; cell: C; today: boolean } | null } {
  const today = schoolDay(now);
  const mins = istMinutes(now);
  const weekday = ((new Date(now.getTime() + 330 * 60_000).getUTCDay() + 6) % 7) + 1; // 1 Mon .. 7 Sun
  let current: { day: number; period: P; cell: C } | null = null;
  for (let offset = 0; offset < 7; offset++) {
    const day = ((weekday - 1 + offset) % 7) + 1;
    if (day === 7) continue;
    for (const p of periods) {
      const cell = cells[cellKey(day, p.id)];
      if (p.isBreak || !cell) continue;
      const start = toMinutes(p.startsAt);
      if (offset === 0 && day === today) {
        if (start <= mins && mins < toMinutes(p.endsAt)) { current = { day, period: p, cell }; continue; }
        if (start < mins) continue;
      }
      return { now: current, next: { day, period: p, cell, today: offset === 0 } };
    }
  }
  return { now: current, next: null };
}
