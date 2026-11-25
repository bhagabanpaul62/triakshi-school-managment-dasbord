// What a person may do next with a request, as flags the screens read. The service enforces the same rules again.
import type { Viewer } from "./access";
import type { Req } from "./base";
import { isOpen } from "./clock";
import type { EscalationLevel } from "./constants";
import { allowed } from "./transitions";

export interface CanInput { v: Viewer; r: Pick<Req, "state" | "ownerId" | "level" | "mergedIntoId" | "solved">; levels: EscalationLevel[]; familyInWindow: boolean }

export function canDo({ v, r, levels, familyInWindow }: CanInput): Record<string, boolean> {
  const open = isOpen(r.state), finished = r.state === "resolved" || r.state === "closed", hasLevel = !!levels[r.level], merged = !!r.mergedIntoId;
  if (v.family) {
    return { reply: open, confirm: r.state === "resolved", reopen: finished && !merged && familyInWindow, escalate: r.state === "resolved" && hasLevel && familyInWindow };
  }
  const mine = r.ownerId === v.userId;
  return {
    claim: open && !r.ownerId, assign: open && (v.office || mine), setCategory: open && (v.office || mine), answer: open, note: r.state !== "closed", ask: open,
    start: allowed(r.state, "start"), resolve: open, close: r.state !== "closed", reopen: finished && !merged, escalate: open && hasLevel, merge: open,
  };
}
