import type { Tone } from "@smw/ui/tone";
import type { PrivacyRequest } from "../privacy-service";

export const STATE_TONES: Record<PrivacyRequest["state"], Tone> = { open: "info", in_progress: "warning", done: "success", refused: "danger", withdrawn: "default" };

/** "Due in 5 days", "Due today", "3 days late"; nothing once it is closed. */
export function dueWords(r: { state: string; daysLeft: number }): { text: string; tone: Tone } | null {
  if (r.state !== "open" && r.state !== "in_progress") return null;
  if (r.daysLeft < 0) return { text: `${-r.daysLeft} ${-r.daysLeft === 1 ? "day" : "days"} late`, tone: "danger" };
  if (r.daysLeft === 0) return { text: "Due today", tone: "warning" };
  return { text: `Due in ${r.daysLeft} ${r.daysLeft === 1 ? "day" : "days"}`, tone: r.daysLeft <= 14 ? "warning" : "default" };
}
