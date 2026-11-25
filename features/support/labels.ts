// Words and small pure helpers shared by the school pages and tests. Safe in the browser.
export type Status = "open" | "pending" | "resolved" | "closed";

export const ticketRef = (number: number) => `T-${number}`;

/** The five stages a school sees, in order. */
export const STAGES = ["Sent", "We are on it", "Waiting for you", "Solved", "Closed"] as const;

/** Which stage a ticket is in (0 to 4). An open ticket the team has touched is "We are on it". */
export function stageOf(t: { status: Status; firstReplyAt?: Date | null; assignedStaffId?: string | null }): number {
  if (t.status === "closed") return 4;
  if (t.status === "resolved") return 3;
  if (t.status === "pending") return 2;
  return t.firstReplyAt || t.assignedStaffId ? 1 : 0;
}

/** The track as StatusTrack wants it. "Waiting for you" is skipped over (done) once the school has answered. */
export function trackFor(t: { status: Status; firstReplyAt?: Date | null; assignedStaffId?: string | null; createdAt: Date; resolvedAt?: Date | null; closedAt?: Date | null }) {
  const at = stageOf(t);
  const when = [t.createdAt, t.firstReplyAt ?? null, null, t.resolvedAt ?? null, t.closedAt ?? null];
  return STAGES.map((label, i) => ({
    label, state: (i < at ? "done" : i === at ? "now" : "todo") as "done" | "now" | "todo",
    at: i <= at && when[i] ? when[i]!.toISOString() : null,
  }));
}

/** The stage word for a badge. */
export const stageLabel = (t: Parameters<typeof stageOf>[0]) => STAGES[stageOf(t)]!;
export const STAGE_TONES = { 0: "info", 1: "info", 2: "warning", 3: "success", 4: "default" } as const;

/** A readable browser name from a user agent, for the "page and browser" line. Never the raw string. */
export function browserName(ua: string | null | undefined): string | undefined {
  if (!ua) return undefined;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iPhone or iPad" : /Windows/i.test(ua) ? "Windows" : /Mac OS X|Macintosh/i.test(ua) ? "Mac" : /Linux|X11/i.test(ua) ? "Linux" : "";
  const b = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\/|CriOS/.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  if (!b && !os) return undefined;
  return [b, os && (b ? `on ${os}` : os)].filter(Boolean).join(" ");
}

export const SLA_LABELS = { met: "Replied in time", late: "Replied late", ok: "On time", soon: "Due soon", overdue: "Overdue", none: "No clock" } as const;
export const SLA_TONES = { met: "success", late: "warning", ok: "default", soon: "warning", overdue: "danger", none: "default" } as const;
