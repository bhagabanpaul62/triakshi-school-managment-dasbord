// Is this answer one the notice asked for? Pure, so the screen can use the same check.
import { ValidationError } from "@smw/feature-kit";
import type { Answer, ResponseSpec } from "./constants";

const NUMBER = /^-?\d+(\.\d+)?$/;
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** The answer cleaned up, or a ValidationError by field. File answers arrive as storage keys in `values`. */
export function checkAnswer(spec: ResponseSpec, a: Answer): Answer {
  if (spec.kind === "none") throw new ValidationError({ answer: "This notice does not ask for an answer" });
  if (a.kind !== spec.kind) throw new ValidationError({ answer: "That is not the answer this notice asks for" });
  if (spec.kind === "ack" || a.kind === "ack") return { kind: "ack" };
  if (spec.kind === "consent" && a.kind === "consent") {
    const reason = a.reason?.trim();
    if (!a.yes && spec.reasonForNo && !reason) throw new ValidationError({ reason: "Say why the answer is no" });
    return { kind: "consent", yes: a.yes, ...(reason ? { reason } : {}) };
  }
  if (spec.kind === "poll" && a.kind === "poll") {
    const choices = [...new Set(a.choices)];
    if (!choices.length || choices.some((c) => !spec.options.includes(c))) throw new ValidationError({ choices: "Choose from the options" });
    if (!spec.multiple && choices.length > 1) throw new ValidationError({ choices: "Choose one option" });
    return { kind: "poll", choices };
  }
  if (spec.kind === "form" && a.kind === "form") {
    const errors: Record<string, string> = {}, values: Record<string, string> = {};
    for (const q of spec.questions) {
      const v = (a.values[q.id] ?? "").trim();
      if (!v) { if (q.required) errors[`values.${q.id}`] = "Answer this question"; continue; }
      if (q.kind === "number" && !NUMBER.test(v)) errors[`values.${q.id}`] = "Enter a number";
      else if (q.kind === "date" && !isDate(v)) errors[`values.${q.id}`] = "Pick a date";
      else if (q.kind === "choice" && !q.options?.includes(v)) errors[`values.${q.id}`] = "Choose from the options";
      else if (q.kind === "yesno" && v !== "yes" && v !== "no") errors[`values.${q.id}`] = "Choose yes or no";
      else values[q.id] = v;
    }
    if (Object.keys(errors).length) throw new ValidationError(errors);
    return { kind: "form", values };
  }
  throw new ValidationError({ answer: "That is not the answer this notice asks for" });
}

export { answerText } from "./answer-text";
