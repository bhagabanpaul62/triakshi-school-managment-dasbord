// The clock of a request, pure: target days are calendar days; waiting for the family stops it.
import { CLOSE_AFTER_DAYS, OPEN_STATES, REOPEN_DAYS, type EscalationLevel, type RequestState } from "./constants";
import { plural } from "@smw/feature-kit/words";

export const DAY = 86_400_000;
export const addDays = (from: Date, days: number) => new Date(from.getTime() + days * DAY);

/** The due time for a request that starts now. */
export const dueFor = (start: Date, targetDays: number) => addDays(start, Math.max(targetDays, 0));

/** The family answered: the time spent waiting is added back, so the school keeps all of its days. */
export const resumeDue = (dueAt: Date, pausedAt: Date, now: Date) => new Date(dueAt.getTime() + Math.max(0, now.getTime() - pausedAt.getTime()));

export interface Clocked { state: RequestState; dueAt: Date; pausedAt: Date | null }
export const isOpen = (state: RequestState) => OPEN_STATES.includes(state);
export const isOverdue = (r: Clocked, now: Date) => isOpen(r.state) && !r.pausedAt && r.dueAt.getTime() < now.getTime();

/** The level a request moves to when it is overdue, or null when it is already at the top. Level 0 is the owner. */
export const nextLevel = (levels: EscalationLevel[], level: number): EscalationLevel | null => levels[level] ?? null;

export const autoCloseAt = (resolvedAt: Date) => addDays(resolvedAt, CLOSE_AFTER_DAYS);
export const familyMayReopen = (since: Date, now: Date) => now.getTime() - since.getTime() <= REOPEN_DAYS * DAY;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Median hours as the report says them. Nothing finished yet is "Not yet", never "0 hours". */
export const hoursWords = (h: number | null) => (h === null ? "Not yet" : h < 1 ? "Under an hour" : h < 48 ? `${Math.round(h * 10) / 10} hours` : `${Math.round((h / 24) * 10) / 10} days`);

/** How long a request has existed, with its unit: "Today", "1 day", "5 days". */
export const ageWords = (days: number) => (days < 1 ? "Today" : `${plural(days, "day")}`);
