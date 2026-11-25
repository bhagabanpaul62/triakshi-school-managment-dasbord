// Quiet hours in IST. Pure: no clock, no database.
export interface QuietRule { from: string; to: string; sundays: boolean; /** "YYYY-MM-DD": the person is back on this day. */ awayUntil?: string | null }

const IST_MS = 330 * 60_000, DAY = 86_400_000;
const minutes = (hhmm: string) => { const [h = 0, m = 0] = hhmm.split(":").map(Number); return h * 60 + m; };

/** When delivery may resume, or null when `now` is not quiet. Overnight windows (20:00 to 07:00) and Sundays all day are handled. */
export function quietUntil(now: Date, rule: QuietRule): Date | null {
  const from = minutes(rule.from), to = minutes(rule.to);
  // Work in "IST wall clock as UTC" so the UTC getters read IST fields.
  const start = now.getTime() + IST_MS;
  let t = start;
  if (rule.awayUntil) t = Math.max(t, Date.parse(`${rule.awayUntil}T00:00:00Z`));
  // Each pass moves forward to the end of one rule, so a few passes settle (Sunday, then the night after it).
  for (let i = 0; i < 6; i++) {
    const day = Math.floor(t / DAY) * DAY, m = Math.floor((t - day) / 60_000);
    let next = t;
    if (rule.sundays && new Date(t).getUTCDay() === 0) next = day + DAY;
    else if (from < to && m >= from && m < to) next = day + to * 60_000;
    else if (from > to && m >= from) next = day + DAY + to * 60_000;
    else if (from > to && m < to) next = day + to * 60_000;
    if (next === t) break;
    t = next;
  }
  return t === start ? null : new Date(t - IST_MS);
}
