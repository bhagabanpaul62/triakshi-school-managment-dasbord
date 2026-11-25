// Client-safe constants and shapes for notices.
export const NOTICE_TYPES = ["notice", "circular", "urgent"] as const;
export type NoticeType = (typeof NOTICE_TYPES)[number];
export const NOTICE_STATES = ["draft", "waiting", "scheduled", "sending", "published", "expired", "withdrawn"] as const;
export type NoticeState = (typeof NOTICE_STATES)[number];
export const UNDO_SECONDS = 30;
export const MAX_FILES = 10;
export const MAX_QUESTIONS = 10;
export const RELATIONS = ["Father", "Mother", "Guardian", "Student", "Staff"] as const;

/** Reminders to people who have not answered: two days before the last date, on it, the day after. Each can be off. */
export interface Reminders { before: boolean; onDay: boolean; after: boolean }

export const QUESTION_KINDS = ["text", "number", "date", "choice", "yesno", "file"] as const;
export interface Question { id: string; label: string; kind: (typeof QUESTION_KINDS)[number]; required: boolean; options?: string[] }
export type ResponseSpec =
  | { kind: "none" } | { kind: "ack" }
  | { kind: "consent"; reasonForNo: boolean }
  | { kind: "poll"; options: string[]; multiple: boolean }
  | { kind: "form"; questions: Question[] };
export type Answer =
  | { kind: "ack" } | { kind: "consent"; yes: boolean; reason?: string }
  | { kind: "poll"; choices: string[] } | { kind: "form"; values: Record<string, string> };

export const NOTICE_TABS = ["live", "waiting", "scheduled", "drafts", "archive"] as const;
export type NoticeTab = (typeof NOTICE_TABS)[number];
export const TAB_STATES: Record<NoticeTab, readonly NoticeState[]> = {
  live: ["published", "sending"], waiting: ["waiting"], scheduled: ["scheduled"], drafts: ["draft"], archive: ["expired", "withdrawn"],
};
/** A person can be reminded about one notice at most this often. */
export const NUDGE_GAP_MS = 24 * 3_600_000;
/** New joiners of a class still get its live notices this long after publish. */
export const LATE_JOIN_DAYS = 30;
/** The category an urgent alert may never use. */
export const NO_URGENT_CATEGORY = "fees";
export const ANSWER_FILTERS = ["unseen", "unanswered", "answered", "unreached"] as const;

/** What the caller may do with one notice right now. The screen shows exactly these and never guesses. */
export interface NoticeCan {
  edit: boolean; submit: boolean; recall: boolean; publish: boolean; schedule: boolean; unschedule: boolean; sendNow: boolean; undo: boolean;
  approve: boolean; /** The caller wrote it and is the only approver: a typed reason is needed. */ approveNeedsReason: boolean;
  askChanges: boolean; reject: boolean; correct: boolean; withdraw: boolean; delete: boolean; duplicate: boolean; report: boolean; website: boolean; urgent: boolean;
}
