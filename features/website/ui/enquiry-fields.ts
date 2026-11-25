import type { Field } from "@smw/ui/shell/FormModal";
import { CALL_OUTCOMES, STAGE_WORDS } from "../enquiry-core";
import { TASK_KINDS } from "../schema";
import type { EnquiryStatus } from "../schema";

type Opt = { value: string; label: string };
const opts = (xs: readonly string[]): Opt[] => xs.map((x) => ({ value: x, label: x }));
export const KIND_WORDS: Record<string, string> = { call: "Call", visit: "Visit", test: "Test", document: "Documents", other: "Other" };
export const STAGE_OPTIONS: Opt[] = (Object.keys(STAGE_WORDS) as EnquiryStatus[]).map((s) => ({ value: s, label: STAGE_WORDS[s] }));
export const STAGE_TONES: Record<string, "default" | "success" | "warning" | "danger" | "info"> = { new: "info", contacted: "info", visit: "warning", visited: "warning", applied: "warning", offered: "warning", waitlist: "default", admitted: "success", closed: "default" };

/** The form for one enquiry's facts. Used to add and to edit. */
export function personFields(o: { classes: string[]; sources: string[]; sessions: string[]; mode: "add" | "edit" }): Field[] {
  return [
    { name: "studentName", label: "Child's name", required: true, section: "Child" },
    { name: "dob", label: "Date of birth", type: "date", section: "Child" },
    o.classes.length ? { name: "classApplying", label: "Class applying for", type: "select", options: opts(o.classes), section: "Child" } : { name: "classApplying", label: "Class applying for", section: "Child" },
    ...(o.sessions.length ? [{ name: "session", label: "Session", type: "select", options: opts(o.sessions), section: "Child" } satisfies Field] : []),
    { name: "previousSchool", label: "Previous school", section: "Child" },
    { name: "parentName", label: "Parent or guardian", required: true, section: "Family" },
    { name: "phone", label: "Mobile number", type: "tel", required: true, section: "Family" },
    { name: "altPhone", label: "Second number", type: "tel", section: "Family" },
    { name: "email", label: "Email", type: "email", section: "Family" },
    { name: "address", label: "Address", type: "textarea", section: "Family" },
    { name: "source", label: "How did they reach you?", type: "select", options: opts(o.sources), section: "More" },
    { name: "message", label: "Message or what they asked", type: "textarea", section: "More" },
    { name: "tags", label: "Tags", hint: "Separate with commas", section: "More" },
    { name: "priority", label: "Priority", type: "checkbox", placeholder: "Handle this one first", section: "More" },
    ...(o.mode === "add" ? [
      { name: "nextKind", label: "Next step", type: "select", options: TASK_KINDS.map((k) => ({ value: k, label: KIND_WORDS[k]! })), section: "Next step", hint: "Every enquiry needs one" } satisfies Field,
      { name: "nextOn", label: "When", type: "datetime-local", section: "Next step", hint: "Left empty: tomorrow at 10 in the morning" } satisfies Field,
    ] : []),
  ];
}

export const callFields: Field[] = [
  { name: "outcome", label: "How did the call go?", type: "select", required: true, options: Object.entries(CALL_OUTCOMES).map(([value, label]) => ({ value, label })), wide: true },
  { name: "laterAt", label: "Call again at", type: "datetime-local", hint: "Only for 'Call later'. Otherwise the next step is made for you." },
  { name: "note", label: "What was said", type: "textarea" },
];
export const noteFields: Field[] = [{ name: "text", label: "Note", type: "textarea", required: true, hint: "Only your team sees this." }];
export const taskFields = (people: Opt[]): Field[] => [
  { name: "kind", label: "What", type: "select", required: true, options: TASK_KINDS.map((k) => ({ value: k, label: KIND_WORDS[k]! })) },
  { name: "dueAt", label: "When", type: "datetime-local", required: true },
  { name: "title", label: "Say more", wide: true },
  { name: "ownerId", label: "Who does it", type: "select", options: people, hint: "Left empty: the owner of the enquiry" },
];
export const visitFields: Field[] = [
  { name: "at", label: "Visit time", type: "datetime-local", required: true, hint: "If the family gave an email, the invitation goes to them with a calendar file." },
  { name: "note", label: "Note", wide: true },
];
export const visitedFields: Field[] = [
  { name: "note", label: "How it went", type: "textarea" },
  { name: "nextOn", label: "Call again at", type: "datetime-local", hint: "Left empty: in two days at 10." },
];
export const moveFields = (reasons: string[]): Field[] => [
  { name: "to", label: "Stage", type: "select", required: true, options: STAGE_OPTIONS.filter((o) => o.value !== "admitted") },
  { name: "reason", label: "If closing: why", type: "select", options: opts(reasons), hint: "Needed only to close." },
];

/** Done asks how it went, and what comes next (or why it is closed): needed when this was the last open step. */
export const doneFields = (reasons: string[]): Field[] => [
  { name: "outcome", label: "How did it go?", required: true, wide: true },
  { name: "nextKind", label: "Next step", type: "select", options: TASK_KINDS.map((k) => ({ value: k, label: KIND_WORDS[k]! })), hint: "Needed if nothing else is planned." },
  { name: "nextOn", label: "When", type: "datetime-local" },
  { name: "closeReason", label: "Or close it: why", type: "select", options: opts(reasons), hint: "Instead of a next step." },
];
