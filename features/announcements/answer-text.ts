// Pure, no imports of the services: screens in the browser use it too.
import type { Answer } from "./constants";

/** A short line for lists and the CSV: "Yes", "No: not well", "Option A, Option B". An urgent alert's answer is "Safe". */
export function answerText(a: Answer | null | undefined, urgent = false): string {
  if (!a) return "";
  switch (a.kind) {
    case "ack": return urgent ? "Safe" : "Read";
    case "consent": return a.yes ? "Yes" : a.reason ? `No: ${a.reason}` : "No";
    case "poll": return a.choices.join(", ");
    case "form": return Object.values(a.values).join(" | ");
  }
}
