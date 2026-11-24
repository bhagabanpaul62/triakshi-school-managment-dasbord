import { expensesApprovals } from "@smw/feature-expenses/approval-handlers";
import { feesApprovals } from "@smw/feature-fees/approval-handlers";
import { financeApprovals } from "@smw/feature-finance/approval-handlers";
import type { ApprovalHandlers } from "@smw/feature-finance/approvals";

/** Every module's approval handlers, merged here so finance never imports fees, expenses or payroll. The lead adds the others. */
export const APPROVAL_HANDLERS: ApprovalHandlers = { ...financeApprovals, ...expensesApprovals, ...feesApprovals };
