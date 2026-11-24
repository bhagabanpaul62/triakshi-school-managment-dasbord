export const BILL_STATUSES = ["draft", "pending", "approved", "rejected", "cancelled"] as const;
export const OUT_METHODS = ["cash", "cheque", "upi", "bank_transfer", "card"] as const;
export const FREQUENCIES = ["monthly", "quarterly", "half_yearly", "yearly"] as const;
export const CLAIM_STATUSES = ["submitted", "approved", "rejected", "paid"] as const;
export const PETTY_STATUSES = ["posted", "reversed"] as const;

/** Cash to one vendor in a day above this needs a written note (Income Tax rule on cash payments). */
export const CASH_NOTE_PAISE = 1_000_000;
/** Bills and claims for more than this many bytes are refused. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const FILE_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
/** Budget alert thresholds, each told once. */
export const BUDGET_ALERTS = [80, 100] as const;
