// The support clock and the rules both sides of support share (school pages and console). Pure: no database, no framework. Working hours are 9 to 18 IST, Monday to Saturday.
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof TICKET_PRIORITIES)[number];

/** Files on a ticket: how many, how big each, and how big together (a server action takes at most 16 MB). */
export const TICKET_FILE_RULES = { maxFiles: 5, maxMb: 10, totalMb: 15 } as const;
/** A plain sentence when these file sizes (bytes) together are too much, else null. Used before upload and again on the server. */
export function filesTotalProblem(sizes: number[]): string | null {
  const total = sizes.reduce((a, b) => a + b, 0);
  const limit = TICKET_FILE_RULES.totalMb * 1048576;
  return total > limit ? `Together your files are ${(total / 1048576).toFixed(1)} MB. The most we can take at once is ${TICKET_FILE_RULES.totalMb} MB: remove one, or send it in a second message.` : null;
}

const IST_OFFSET_MS = 330 * 60_000;
export const WORK_START = 9;
export const WORK_END = 18;
const HOUR = 3_600_000;

/** Target first-reply hours, counted in working hours. */
export const REPLY_HOURS: Record<Priority, number> = { urgent: 2, high: 8, normal: 24, low: 72 };
/** Plans that get the urgent target halved. The keys do not exist yet in every setup; a plan not listed gets the normal target. */
export const FAST_PLANS = ["pro", "enterprise"] as const;

/** The target for a ticket, in working hours. */
export function replyHours(priority: Priority, planKey?: string | null): number {
  const h = REPLY_HOURS[priority];
  return priority === "urgent" && planKey && (FAST_PLANS as readonly string[]).includes(planKey) ? h / 2 : h;
}

/** IST wall clock of an instant, as a plain UTC date (so the UTC getters read IST). */
const wall = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS);
const fromWall = (d: Date) => new Date(d.getTime() - IST_OFFSET_MS);
const isWorkDay = (w: Date) => w.getUTCDay() !== 0;
const dayStart = (w: Date, hour: number) => new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), hour));

/** The first working moment at or after `d`. */
export function nextWorkingMoment(d: Date): Date {
  let w = wall(d);
  for (let i = 0; i < 8; i++) {
    if (isWorkDay(w)) {
      if (w < dayStart(w, WORK_START)) return fromWall(dayStart(w, WORK_START));
      if (w < dayStart(w, WORK_END)) return fromWall(w);
    }
    w = dayStart(new Date(w.getTime() + 24 * HOUR), WORK_START);
  }
  return d;
}

/** `from` plus `hours` of working time. Outside working hours the clock starts at the next opening. */
export function addWorkingHours(from: Date, hours: number): Date {
  let w = wall(nextWorkingMoment(from));
  let left = hours * HOUR;
  for (let i = 0; i < 400 && left > 0; i++) {
    const end = dayStart(w, WORK_END);
    const room = end.getTime() - w.getTime();
    if (left <= room) return fromWall(new Date(w.getTime() + left));
    left -= room;
    w = wall(nextWorkingMoment(fromWall(new Date(end.getTime() + HOUR))));
  }
  return fromWall(w);
}

/** Working hours between two instants (zero when `to` is not after `from`). */
export function workingHoursBetween(from: Date, to: Date): number {
  if (to <= from) return 0;
  let w = wall(nextWorkingMoment(from));
  const stop = wall(to);
  let total = 0;
  for (let i = 0; i < 4000 && w < stop; i++) {
    const end = dayStart(w, WORK_END);
    const upTo = stop < end ? stop : end;
    total += Math.max(0, upTo.getTime() - w.getTime());
    w = wall(nextWorkingMoment(fromWall(new Date(end.getTime() + HOUR))));
  }
  return total / HOUR;
}

export type SlaState = "met" | "late" | "ok" | "soon" | "overdue" | "none";

/**
 * Where the first reply stands. `met` replied in time, `late` replied after the target, `ok` plenty of time,
 * `soon` under two working hours left, `overdue` past the target and still no reply, `none` no clock (closed, or not set yet).
 */
export function slaState(t: { status: string; replyDueAt: Date | null; firstReplyAt: Date | null }, now = new Date()): SlaState {
  if (t.firstReplyAt) return t.replyDueAt && t.firstReplyAt > t.replyDueAt ? "late" : "met";
  if (!t.replyDueAt || t.status === "closed") return "none";
  if (now > t.replyDueAt) return "overdue";
  return workingHoursBetween(now, t.replyDueAt) < 2 ? "soon" : "ok";
}

/** The reply time shown to a school: the stored due time, or the one the clock will set, from the day it was sent. */
export function expectedReplyBy(t: { createdAt: Date; priority: Priority; replyDueAt: Date | null }, planKey?: string | null): Date {
  return t.replyDueAt ?? addWorkingHours(t.createdAt, replyHours(t.priority, planKey));
}
