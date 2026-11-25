import { z } from "zod";
import { f } from "@smw/feature-kit";
import { PRIVACY_KINDS, PRIVACY_STATES } from "./privacy-kinds";

export { PRIVACY_KIND_WORDS } from "./privacy-kinds";
export const PRIVACY_STATE_WORDS: Record<(typeof PRIVACY_STATES)[number], string> = {
  open: "New", in_progress: "In progress", done: "Done", refused: "Refused", withdrawn: "Withdrawn",
};

const kind = z.enum(PRIVACY_KINDS, { error: "Choose what you are asking for" });
const details = f.text(10, 2000, "Say what you need, in a sentence or two (at least 10 characters)");

/** A person's own request from My profile → My data. About themselves only; the service fills in who. */
export const raiseInput = z.object({ kind, details, contact: f.optText(200) });

/** The office writes a request down (a parent came to the desk, or wrote). */
export const privacyInput = z.object({
  kind, details,
  subjectType: z.enum(["student", "staff", "enquiry", "other"], { error: "Choose who it is about" }),
  subjectId: f.optId(),
  subjectName: f.text(2, 120, "Write the person's name"),
  raisedByName: f.text(2, 120, "Write who is asking"),
  contact: f.optText(200),
  ownerId: f.optId(),
});

export const stepInput = z.object({ text: f.text(3, 1000, "Write what was done") });
export const closeInput = z.object({
  state: z.enum(["in_progress", "done", "refused", "withdrawn"], { error: "Choose the outcome" }),
  outcome: f.optText(1000),
});
export const privacyDaysInput = z.object({ days: f.int(7, 180) });

export const supportAccessInput = z.object({ mode: z.enum(["always", "24h", "72h", "never"], { error: "Choose one" }) });

export const closureInput = z.object({
  schoolName: f.text(1, 200, "Type your school's name"),
  reason: f.text(10, 1000, "Tell us why (at least 10 characters)"),
});
