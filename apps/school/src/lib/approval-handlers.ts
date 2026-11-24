import { financeApprovals } from "@smw/feature-finance/approval-handlers";
import type { ApprovalHandlers } from "@smw/feature-finance/approvals";

/** Every module's approval handlers, merged here so finance never imports fees, expenses or payroll. The lead adds the others. */
export const APPROVAL_HANDLERS: ApprovalHandlers = { ...financeApprovals };
