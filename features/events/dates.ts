// Pure date helpers. Schools run on Indian Standard Time, so "a day" always means a day in IST.
// No framework imports: used by the service, the seed and the calendar UI.
const TZ = "Asia/Kolkata";
const DAY_MS = 86_400_000;
const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const clock = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "2026-11-18" or "2026-11-18T09:30" (IST wall time) to an instant. Null when it is not a date. */
export function parseIst(v: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?$/.exec(v.trim());
  const d = m ? new Date(`${m[1]}T${m[2] ?? "00:00"}:00+05:30`) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** The IST calendar day of an instant: "YYYY-MM-DD". */
export const istDay = (d: Date | string) => day.format(new Date(d));

/** Value for an `<input type="datetime-local">`, in IST. */
export const toInputValue = (d: Date | string | null | undefined) => (d ? `${istDay(d)}T${clock.format(new Date(d))}` : "");

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
