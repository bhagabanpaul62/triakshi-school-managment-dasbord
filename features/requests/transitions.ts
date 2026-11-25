// Every state change of a request in one table. The service asks `next`; nothing else decides.
import type { RequestState } from "./constants";

export type Action = "assign" | "start" | "answer" | "ask" | "familyReply" | "resolve" | "close" | "reopen" | "escalate" | "merge";

const OPEN: RequestState[] = ["new", "assigned", "in_progress", "waiting"];
const same = (s: RequestState) => s;

const TABLE: Record<Action, { from: RequestState[]; to: (s: RequestState, hasOwner: boolean) => RequestState }> = {
  assign: { from: OPEN, to: (s) => (s === "new" ? "assigned" : s) },
  start: { from: ["new", "assigned"], to: () => "in_progress" },
  answer: { from: OPEN, to: (s) => (s === "new" || s === "assigned" ? "in_progress" : s) },
  ask: { from: ["new", "assigned", "in_progress", "waiting"], to: () => "waiting" },
  familyReply: { from: OPEN, to: (s) => (s === "waiting" ? "in_progress" : s) },
  resolve: { from: OPEN, to: () => "resolved" },
  close: { from: [...OPEN, "resolved"], to: () => "closed" },
  reopen: { from: ["resolved", "closed"], to: (_s, owned) => (owned ? "assigned" : "new") },
  // Staff escalate an open request (state stays); a family escalates a resolved one, which opens it again.
  escalate: { from: [...OPEN, "resolved"], to: (s, owned) => (s === "resolved" ? (owned ? "assigned" : "new") : same(s)) },
  merge: { from: OPEN, to: () => "closed" },
};

/** The state after `action`, or null when this state does not allow it. */
export function next(state: RequestState, action: Action, hasOwner = false): RequestState | null {
  const t = TABLE[action];
  return t.from.includes(state) ? t.to(state, hasOwner) : null;
}
export const allowed = (state: RequestState, action: Action) => TABLE[action].from.includes(state);
