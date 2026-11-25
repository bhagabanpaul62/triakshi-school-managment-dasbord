// Client-safe constants for parent-teacher meetings.
export const MEETING_STATES = ["draft", "open", "closed", "done", "cancelled"] as const;
export type MeetingState = (typeof MEETING_STATES)[number];
export type SlotState = "open" | "break" | "booked" | "removed";
export type VisitState = "came" | "missed" | "late";
