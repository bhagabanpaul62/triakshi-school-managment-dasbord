// Client-safe: the forms use these without pulling the database schema into the browser.
export const PRIVACY_KINDS = ["access", "correction", "erasure", "withdraw_consent", "complaint"] as const;
export const PRIVACY_STATES = ["open", "in_progress", "done", "refused", "withdrawn"] as const;

export const PRIVACY_KIND_WORDS: Record<(typeof PRIVACY_KINDS)[number], string> = {
  access: "A copy of my data", correction: "Correct my data", erasure: "Delete my data", withdraw_consent: "Withdraw my consent", complaint: "A complaint about my data",
};
