// Client-safe constants for requests.
export const REQUEST_STATES = ["new", "assigned", "in_progress", "waiting", "resolved", "closed"] as const;
export type RequestState = (typeof REQUEST_STATES)[number];
export interface EscalationLevel { label: string; role: string; afterDays: number }
export interface RequestField { id: string; label: string; kind: "text" | "date" | "choice"; required: boolean; options?: string[] }
export const CLOSE_AFTER_DAYS = 7;
export const REOPEN_DAYS = 14;

export const OPEN_STATES: readonly RequestState[] = ["new", "assigned", "in_progress", "waiting"];
export const NATURES = ["general", "complaint", "safety"] as const;
export type Nature = (typeof NATURES)[number];
export const NATURE_WORDS: Record<Nature, string> = { general: "General", complaint: "Complaint about a person", safety: "Safety concern" };
export const REQUEST_STATE_WORDS: Record<RequestState, string> = { new: "New", assigned: "Assigned", in_progress: "In progress", waiting: "Waiting for family", resolved: "Resolved", closed: "Closed" };
/** What a family sees: the same states in their words. */
export const FAMILY_STATE_WORDS: Record<RequestState, string> = { new: "Received", assigned: "With the school", in_progress: "Being looked at", waiting: "Waiting for you", resolved: "Answered", closed: "Closed" };
export const REQUEST_STATE_TONE: Record<RequestState, "default" | "success" | "warning" | "danger" | "info"> = { new: "info", assigned: "info", in_progress: "warning", waiting: "warning", resolved: "success", closed: "default" };
/** Saved views of the queue. The first is the default. */
export const VIEWS = [["mine", "Mine"], ["unassigned", "Unassigned"], ["team", "Team"], ["overdue", "Overdue"], ["all", "All"]] as const;
export type ViewKey = (typeof VIEWS)[number][0];
export const PAGE_SIZE = 25;
export const MAX_ABOUT = 3;
/** Actions a family may see in its timeline; everything else is for staff. */
export const FAMILY_EVENTS = ["raised", "answered", "asked", "replied", "resolved", "closed", "reopened", "escalated", "merged", "category", "feedback"] as const;
