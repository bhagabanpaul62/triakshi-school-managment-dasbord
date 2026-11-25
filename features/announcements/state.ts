// The life of a notice in one table. Every change of state in the services goes through `transition`.
import { ConflictError } from "@smw/feature-kit";
import type { NoticeState } from "./constants";

export const ACTIONS = [
  "edit", "submit", "recall", "approve", "approveScheduled", "askChanges", "reject", "schedule", "unschedule", "publish", "sendNow", "due", "undo", "fanOut", "correct", "expire", "withdraw", "delete",
] as const;
export type NoticeAction = (typeof ACTIONS)[number];
export type NextState = NoticeState | "deleted";

export const TRANSITIONS: Record<NoticeState, Partial<Record<NoticeAction, NextState>>> = {
  draft: { edit: "draft", submit: "waiting", schedule: "scheduled", publish: "sending", delete: "deleted" },
  waiting: { recall: "draft", approve: "sending", approveScheduled: "scheduled", askChanges: "draft", reject: "draft" },
  scheduled: { unschedule: "draft", sendNow: "sending", due: "sending" },
  sending: { undo: "draft", fanOut: "published" },
  published: { correct: "published", expire: "expired", withdraw: "withdrawn", fanOut: "published" },
  expired: { withdraw: "withdrawn" },
  withdrawn: {},
};

const WHY: Record<NoticeState, string> = {
  draft: "a draft", waiting: "waiting for approval", scheduled: "scheduled", sending: "being sent", published: "published", expired: "expired", withdrawn: "withdrawn",
};
const VERB: Record<NoticeAction, string> = {
  edit: "edited here", submit: "sent for approval", recall: "taken back", approve: "approved", approveScheduled: "approved", askChanges: "sent back", reject: "rejected", schedule: "scheduled", unschedule: "unscheduled",
  publish: "published", sendNow: "sent now", due: "sent", undo: "undone", fanOut: "sent", correct: "corrected", expire: "expired", withdraw: "withdrawn", delete: "deleted",
};

export const can = (state: NoticeState, action: NoticeAction) => TRANSITIONS[state][action] !== undefined;

/** The state after `action`, or a plain ConflictError saying why not. */
export function transition(state: NoticeState, action: NoticeAction): NextState {
  const next = TRANSITIONS[state][action];
  if (next === undefined) throw new ConflictError(`This notice is ${WHY[state]}, so it cannot be ${VERB[action]}.`);
  return next;
}
