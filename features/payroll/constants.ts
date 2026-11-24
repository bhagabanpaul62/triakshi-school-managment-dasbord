export const COMPONENT_KINDS = ["earning", "deduction", "employer"] as const;
export const COMPONENT_MODES = ["fixed", "percent_of_basic", "percent_of_gross", "remainder"] as const;
export const RUN_STATUSES = ["draft", "reviewed", "approved", "paid", "cancelled"] as const;
export const RUN_KINDS = ["monthly", "off_cycle", "exit"] as const;
export const PAYOUT_STATUSES = ["pending", "paid", "failed"] as const;
export const LOAN_STATUSES = ["pending", "active", "paused", "closed", "rejected"] as const;
export const EXIT_STATUSES = ["draft", "pending", "approved", "paid", "rejected"] as const;
/** Lines the product works out; everything else is the school's own component. */
export const STATUTORY_LINES = ["pf_employee", "pf_employer", "eps_employer", "edli", "pf_admin", "esi_employee", "esi_employer", "pt", "lwf_employee", "lwf_employer", "tds"] as const;
export const CONFIDENCE = ["high", "medium", "low"] as const;
