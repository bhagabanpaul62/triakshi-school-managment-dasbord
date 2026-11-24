import type { ControlCheck } from "@smw/feature-finance/services/control";

/** The ledger checks of fees, expenses and payroll, composed here once for the dashboard, the year close and the worker (`financeJobs(FINANCE_CHECKS)`). */
export const FINANCE_CHECKS: ControlCheck[] = [];
/** Anything else that must be finished before a year closes. Each problem returned blocks the close. */
export const CLOSE_BLOCKERS: ControlCheck[] = [];
