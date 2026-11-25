// Every communication state in one map, with no React, so services can use the labels in emails and exports.
import type { Tone } from "../../lib/tone";

export type CommKind = "notice" | "request" | "report" | "event" | "rsvp" | "slot" | "delivery";
export type CommIcon = "pencil" | "hourglass" | "clock" | "calendar" | "send" | "check" | "checks" | "eye" | "x" | "alert" | "ban" | "undo" | "archive" | "mailoff" | "question" | "dot";
export type CommState = { label: string; tone: Tone; icon: CommIcon };

const s = (label: string, tone: Tone, icon: CommIcon): CommState => ({ label, tone, icon });

export const COMM_STATES: Record<CommKind, Record<string, CommState>> = {
  notice: {
    draft: s("Draft", "default", "pencil"),
    pending_approval: s("Waiting for approval", "warning", "hourglass"),
    scheduled: s("Scheduled", "info", "clock"),
    published: s("Published", "success", "check"),
    expired: s("Expired", "default", "clock"),
    rejected: s("Sent back", "danger", "x"),
    withdrawn: s("Withdrawn", "default", "undo"),
    archived: s("Archived", "default", "archive"),
  },
  request: {
    submitted: s("Submitted", "info", "send"),
    in_review: s("Being looked at", "warning", "eye"),
    info_needed: s("Needs more details", "warning", "question"),
    approved: s("Approved", "success", "check"),
    done: s("Done", "success", "checks"),
    rejected: s("Not approved", "danger", "x"),
    withdrawn: s("Withdrawn", "default", "undo"),
    cancelled: s("Cancelled", "default", "ban"),
  },
  report: {
    new: s("New", "warning", "alert"),
    in_review: s("Being looked at", "info", "eye"),
    escalated: s("Escalated", "danger", "alert"),
    resolved: s("Resolved", "success", "check"),
    closed: s("Closed", "default", "archive"),
  },
  event: {
    draft: s("Draft", "default", "pencil"),
    upcoming: s("Upcoming", "info", "calendar"),
    today: s("Today", "warning", "calendar"),
    ongoing: s("Happening now", "success", "clock"),
    done: s("Over", "default", "check"),
    postponed: s("Postponed", "warning", "clock"),
    cancelled: s("Cancelled", "danger", "ban"),
  },
  rsvp: {
    going: s("Going", "success", "check"),
    maybe: s("Maybe", "warning", "question"),
    not_going: s("Not going", "default", "x"),
    no_reply: s("No reply yet", "default", "clock"),
  },
  slot: {
    open: s("Open", "info", "calendar"),
    held: s("Held for you", "warning", "hourglass"),
    booked: s("Booked", "success", "check"),
    confirmed: s("Confirmed", "success", "checks"),
    completed: s("Completed", "default", "checks"),
    missed: s("Did not happen", "danger", "alert"),
    cancelled: s("Cancelled", "default", "ban"),
  },
  delivery: {
    queued: s("Waiting to send", "default", "clock"),
    held: s("Held for quiet hours", "warning", "hourglass"),
    sent: s("Sent", "info", "send"),
    delivered: s("Delivered", "success", "check"),
    seen: s("Seen", "success", "eye"),
    failed: s("Failed", "danger", "alert"),
    bounced: s("Email bounced", "danger", "mailoff"),
    suppressed: s("Not sent: turned off", "default", "mailoff"),
    skipped: s("Skipped", "default", "ban"),
  },
};

/** Label, tone and icon of a state. An unknown state shows its own text in neutral, never a blank. */
export function commState(kind: CommKind, state: string): CommState {
  return COMM_STATES[kind]?.[state] ?? s(state ? state.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Unknown", "default", "dot");
}
