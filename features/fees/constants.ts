// Plain values shared by the schema, services and client components (no drizzle, no React).
export const FEE_HEAD_KINDS = ["tuition", "admission", "transport", "exam", "other"] as const;
export const FEE_HEAD_TYPES = ["income", "deposit"] as const;
export const PLAN_STATUSES = ["draft", "pending", "published", "archived"] as const;
export const ADMISSION_TYPES = ["all", "new", "existing"] as const;
export const INVOICE_KINDS = ["plan", "transport", "library_fine", "custom", "opening", "bounce"] as const;
export const INVOICE_STATUSES = ["draft", "issued", "cancelled"] as const;
export const LINE_KINDS = ["fee", "deposit", "late", "bounce", "opening"] as const;
export const NOTE_KINDS = ["credit", "debit"] as const;
export const NOTE_REASONS = ["concession", "waiver", "write_off", "correction"] as const;
export const REQUEST_STATUSES = ["pending", "approved", "rejected"] as const;
export const CONCESSION_STATUSES = ["pending", "approved", "rejected", "ended"] as const;
export const RECEIPT_STATUSES = ["valid", "clearing", "bounced", "reversed"] as const;
export const PAY_METHODS = ["cash", "cheque", "upi", "card", "bank_transfer", "advance"] as const;
export const ADVANCE_KINDS = ["receipt", "used", "refund", "undo", "opening", "deposit"] as const;
export const CHEQUE_STATUSES = ["received", "deposited", "cleared", "bounced", "cancelled"] as const;
export const REFUND_SOURCES = ["advance", "deposit"] as const;
export const SLIP_STATUSES = ["submitted", "verified", "rejected"] as const;
/** The state a person sees; worked out from the totals and dates, never stored. */
export const DUE_STATES = ["draft", "paid", "part_paid", "due", "overdue", "upcoming", "cancelled"] as const;
export type DueState = (typeof DUE_STATES)[number];
export type PayMethod = (typeof PAY_METHODS)[number];
export const METHOD_LABEL: Record<PayMethod, string> = { cash: "Cash", cheque: "Cheque", upi: "UPI", card: "Card", bank_transfer: "Bank transfer", advance: "Advance" };

/** flat: once after grace. per_day: every late day. percent: basis points of what is open, once. slabs: the last slab reached. */
export interface LateRule { kind: "flat" | "per_day" | "percent" | "slabs"; amountPaise?: number; basisPoints?: number; graceDays: number; maxPaise?: number | null; slabs?: { afterDays: number; amountPaise: number }[] }

/** The age filter of the dues report: how late what is open is. Keys ride in the address, so they never change. */
export const AGE_BANDS = [
  { key: "not-due", label: "Not yet due" }, { key: "0-30", label: "1 to 30 days late" }, { key: "31-60", label: "31 to 60 days late" }, { key: "61-90", label: "61 to 90 days late" }, { key: "90+", label: "Over 90 days late" },
] as const;
export type AgeBand = (typeof AGE_BANDS)[number]["key"];
