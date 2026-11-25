// Every communication state in one map, with no React, so services can use the labels in emails and exports.
import type { Tone } from "../../lib/tone";

// Each kind lists exactly the states its module stores or derives (NOTICE_STATES, REQUEST_STATES, REPORT_STATES, MEETING_STATES, DELIVERY_STATES, events and slots).
export type CommKind = "notice" | "request" | "family_request" | "report" | "event" | "rsvp" | "meeting" | "slot" | "delivery";
export type CommIcon = "pencil" | "hourglass" | "clock" | "calendar" | "send" | "check" | "checks" | "eye" | "x" | "alert" | "ban" | "undo" | "archive" | "mailoff" | "question" | "dot";
export type CommState = { label: string; tone: Tone; icon: CommIcon };

const s = (label: string, tone: Tone, icon: CommIcon): CommState => ({ label, tone, icon });

export const COMM_STATES: Record<CommKind, Record<string, CommState>> = {
  notice: {
    draft: s("Draft", "default", "pencil"),
    waiting: s("Waiting for approval", "warning", "hourglass"),
    scheduled: s("Scheduled", "info", "clock"),
    sending: s("Sending", "info", "send"),
    published: s("Published", "success", "check"),
    expired: s("Expired", "default", "clock"),
    withdrawn: s("Withdrawn", "default", "undo"),
  },
  request: {
    new: s("New", "info", "send"),
    assigned: s("Assigned", "info", "eye"),
    in_progress: s("In progress", "warning", "clock"),
    waiting: s("Waiting for family", "warning", "question"),
    resolved: s("Resolved", "success", "check"),
    closed: s("Closed", "default", "archive"),
  },
  /** The same request states in the family's words. */
  family_request: {
    new: s("Received", "info", "send"),
    assigned: s("With the school", "info", "eye"),
    in_progress: s("Being looked at", "warning", "clock"),
    waiting: s("Waiting for you", "warning", "question"),
    resolved: s("Answered", "success", "check"),
    closed: s("Closed", "default", "archive"),
  },
  report: {
    new: s("Received", "warning", "alert"),
    reviewing: s("Being looked at", "info", "eye"),
    action: s("Action taken", "success", "check"),
    no_action: s("Looked at, no action needed", "default", "archive"),
  },
  event: {
    draft: s("Draft", "default", "pencil"),
    upcoming: s("Upcoming", "info", "calendar"),
    today: s("Today", "warning", "calendar"),
    ongoing: s("Happening now", "success", "clock"),
    done: s("Over", "default", "check"),
    cancelled: s("Cancelled", "danger", "ban"),
  },
  rsvp: {
    going: s("Going", "success", "check"),
    maybe: s("Maybe", "warning", "question"),
    not_going: s("Not going", "default", "x"),
    no_reply: s("No reply yet", "default", "clock"),
  },
  meeting: {
    draft: s("Draft", "default", "pencil"),
    open: s("Open for booking", "info", "calendar"),
    closed: s("Booking closed", "warning", "ban"),
    done: s("Done", "default", "checks"),
    cancelled: s("Cancelled", "danger", "ban"),
  },
  slot: {
    open: s("Open", "info", "calendar"),
    break: s("Break", "default", "clock"),
    booked: s("Booked", "success", "check"),
    removed: s("Removed", "default", "ban"),
    came: s("Came", "success", "checks"),
    late: s("Came late", "warning", "clock"),
    missed: s("Did not come", "danger", "alert"),
  },
  delivery: {
    pending: s("Waiting to send", "default", "clock"),
    sent: s("Sent", "success", "send"),
    failed: s("Failed", "danger", "alert"),
    bounced: s("Email bounced", "danger", "mailoff"),
    skipped: s("Not sent", "default", "ban"),
  },
};

/** Label, tone and icon of a state. An unknown state shows its own text in neutral, never a blank. */
export function commState(kind: CommKind, state: string): CommState {
  return COMM_STATES[kind]?.[state] ?? s(state ? state.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()) : "Unknown", "default", "dot");
}
