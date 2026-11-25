// Client-safe constants for requests. Words and colours of a state live once, in the shared comm states.
import { COMM_STATES } from "@smw/ui/comm/states";
export const REQUEST_STATES = ["new", "assigned", "in_progress", "waiting", "resolved", "closed"] as const;
export type RequestState = (typeof REQUEST_STATES)[number];
export interface EscalationLevel { label: string; role: string; afterDays: number }
export interface RequestField { id: string; label: string; kind: "text" | "date" | "choice"; required: boolean; options?: string[] }
/** How far a late request may climb, and how many extra questions a category may ask. */
export const MAX_LEVELS = 5;
export const MAX_QUESTIONS = 8;
export const CLOSE_AFTER_DAYS = 7;
export const REOPEN_DAYS = 14;

export const OPEN_STATES: readonly RequestState[] = ["new", "assigned", "in_progress", "waiting"];
export const NATURES = ["general", "complaint", "safety"] as const;
export type Nature = (typeof NATURES)[number];
export const NATURE_WORDS: Record<Nature, string> = { general: "General", complaint: "Complaint about a person", safety: "Safety concern" };
const fromStates = <T,>(kind: "request" | "family_request", pick: (s: (typeof COMM_STATES)["request"][string]) => T) =>
  Object.fromEntries(REQUEST_STATES.map((k) => [k, pick(COMM_STATES[kind][k]!)])) as Record<RequestState, T>;
export const REQUEST_STATE_WORDS = fromStates("request", (s) => s.label);
export const REQUEST_STATE_TONE = fromStates("request", (s) => s.tone);
/** Saved views of the queue. The first is the default. */
export const VIEWS = [["mine", "Mine"], ["unassigned", "Unassigned"], ["team", "Team"], ["overdue", "Overdue"], ["all", "All"]] as const;
export type ViewKey = (typeof VIEWS)[number][0];
export const PAGE_SIZE = 25;
export const MAX_ABOUT = 3;
/** Actions a family may see in its timeline; everything else is for staff. */
export const FAMILY_EVENTS = ["raised", "answered", "asked", "replied", "resolved", "closed", "reopened", "escalated", "merged", "category", "feedback"] as const;
/** The three things staff write under a request, and the line that says who will see each. */
export type ReplyMode = "reply" | "answer" | "ask" | "note";
export const MODE_WORDS = {
  answer: { tab: "Answer", who: "The family sees this", placeholder: "Write the answer" },
  ask: { tab: "Ask", who: "The family sees this. The school's clock waits for their reply", placeholder: "Ask the family a question" },
  note: { tab: "Note", who: "Only staff see this", placeholder: "Write a note for staff" },
} as const;
