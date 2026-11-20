// Pure rules (no database, no framework): due-date handling, what a student sees, progress counts.
import type { AssignmentStatus, SubmissionStatus } from "./schema";

const IST_MS = 330 * 60_000;

/** A form's "2026-11-20T17:00" is India wall-clock time; anything with a zone (ISO from a seed or the API) is taken as is. */
export function parseDue(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/i.test(s) && /T/.test(s);
  const d = new Date(zoned ? s : `${s}${/T\d{2}:\d{2}$/.test(s) ? ":00" : ""}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The value a datetime-local input expects, in India time: "2026-11-20T17:00". */
export const toIstInput = (d: Date | string | null | undefined): string =>
  d ? new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 16) : "";

export const isLate = (dueAt: Date, at: Date) => at.getTime() > dueAt.getTime();

/** What one student sees for one assignment. `todo` and `returned` need action; `overdue` means nothing was handed in. */
export type SelfState = "todo" | "overdue" | "submitted" | "late" | "graded" | "returned";

/** `dueAt` is the student's own due date: the assignment's, or their extension. */
export function selfState(a: { dueAt: Date; status: AssignmentStatus }, sub: { status: SubmissionStatus } | null, now: Date, dueAt: Date = a.dueAt): SelfState {
  if (sub) return sub.status;
  return a.status === "published" && !isLate(dueAt, now) ? "todo" : "overdue";
}

const RANK: Record<SelfState, number> = { todo: 0, returned: 0, overdue: 1, submitted: 2, late: 2, graded: 2 };

/** Open work by nearest due date first, then missed work (newest first), then everything handed in. */
export function sortSelf<T extends { state: SelfState; dueAt: Date }>(rows: T[]): T[] {
  return [...rows].sort((x, y) => {
    if (RANK[x.state] !== RANK[y.state]) return RANK[x.state] - RANK[y.state];
    const d = x.dueAt.getTime() - y.dueAt.getTime();
    return RANK[x.state] === 0 ? d : -d;
  });
}

/** `missing` = nothing handed in and no time left. `pending` = nothing handed in yet, but an extension is still running. */
export interface Progress { total: number; submitted: number; late: number; graded: number; returned: number; missing: number; pending: number }
export const EMPTY_PROGRESS: Progress = { total: 0, submitted: 0, late: 0, graded: 0, returned: 0, missing: 0, pending: 0 };

/** Counts for one assignment from the class size, the submission counts by status and how many unsubmitted students still have an extension running. */
export function tally(total: number, byStatus: Partial<Record<SubmissionStatus, number>>, pending = 0): Progress {
  const submitted = byStatus.submitted ?? 0, late = byStatus.late ?? 0, graded = byStatus.graded ?? 0, returned = byStatus.returned ?? 0;
  const none = Math.max(0, total - submitted - late - graded - returned);
  const p = Math.min(pending, none);
  return { total, submitted, late, graded, returned, missing: none - p, pending: p };
}

/** Students who handed something in, whatever its state. */
export const handedIn = (p: Progress) => p.total - p.missing - p.pending;

/** Share of the class that has handed something in, 0..100. */
export const turnedIn = (p: Progress) => (p.total === 0 ? 0 : Math.round((handedIn(p) / p.total) * 100));

/** A comment can be edited by its author, and deleted by its author, for this long. Staff who grade the work can delete any comment. */
export const COMMENT_WINDOW_MS = 15 * 60_000;
export const withinCommentWindow = (createdAt: Date, now: Date) => now.getTime() - createdAt.getTime() <= COMMENT_WINDOW_MS;

const DAY = 86_400_000;
const dayOf = (d: Date) => Math.floor((d.getTime() + IST_MS) / DAY);

/** "Due today", "Due in 3 days", "2 days overdue": calendar days in India time, not 24-hour blocks. */
export function dueHint(dueAt: Date, now: Date): string {
  if (isLate(dueAt, now)) {
    const n = dayOf(now) - dayOf(dueAt);
    return n === 0 ? "Overdue" : `${n} day${n === 1 ? "" : "s"} overdue`;
  }
  const n = dayOf(dueAt) - dayOf(now);
  return n === 0 ? "Due today" : n === 1 ? "Due tomorrow" : `Due in ${n} days`;
}
