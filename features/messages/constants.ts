// Client-safe constants for conversations.
export const THREAD_KINDS = ["student", "staff", "request", "legacy"] as const;
export type ThreadKind = (typeof THREAD_KINDS)[number];
export type ThreadState = "open" | "closed";
export type MemberState = "active" | "left";
export const REPORT_STATES = ["new", "reviewing", "action", "no_action"] as const;
export type ReportState = (typeof REPORT_STATES)[number];
export const REPORT_CATEGORIES = { unsafe: "Someone may be unsafe", abusive: "Rude or abusive", inappropriate: "Inappropriate for a child", pressure: "Pressure, threat or money", other: "Something else" } as const;
export type ReportCategory = keyof typeof REPORT_CATEGORIES;
export const REPORT_STATE_WORDS: Record<ReportState, string> = { new: "Received", reviewing: "Being looked at", action: "Action taken", no_action: "Looked at, no action needed" };
export type RestrictionKind = "reply_only" | "blocked";
export const RESTRICTION_WORDS: Record<RestrictionKind, string> = { reply_only: "Can reply, cannot start new conversations", blocked: "Cannot send any message" };
export const PER_MINUTE = 20;
export const NEW_PER_DAY = { family: 10, staff: 60 } as const;
export const REMOVE_MINUTES = 10;
export const MAX_FILES = 5;
export const MAX_FILE_MB = 15;
/** Pictures and PDFs only; the bytes are checked, not just the name. */
export const FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
export const LINK_SECONDS = 60;
/** After opening a conversation with a typed reason, the reviewer may open its files for this long. */
export const REVIEW_HOURS = 8;
export const PAGE_SIZE = 30;
export const THREAD_WINDOW = 100;
export const BODY_MAX = 4000;
export const REVIEW_BANNER = "The school can review this conversation.";
export const MAX_FAMILIES = 1000;
/** Kinds that have one family in them. */
export const FAMILY_KINDS: readonly ThreadKind[] = ["student", "request"];
export const ROLE_WORDS: Record<string, string> = { admin: "Admin", accountant: "Accountant", teacher: "Teacher", student: "Family", parent: "Family", staff: "Staff" };
