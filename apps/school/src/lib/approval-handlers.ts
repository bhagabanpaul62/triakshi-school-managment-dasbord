import { expensesApprovals } from "@smw/feature-expenses/approval-handlers";
import { feesApprovals } from "@smw/feature-fees/approval-handlers";
import { financeApprovals } from "@smw/feature-finance/approval-handlers";
import { payrollApprovals } from "@smw/feature-payroll/approval-handlers";
import type { ApprovalHandlers } from "@smw/feature-finance/approvals";
import { YearCloseService } from "@smw/feature-finance/services/year-close";
import { CLOSE_BLOCKERS, FINANCE_CHECKS } from "./finance-checks";

/** Every module's approval handlers, merged here so finance never imports fees, expenses or payroll. */
export const APPROVAL_HANDLERS: ApprovalHandlers = { ...financeApprovals, ...expensesApprovals, ...feesApprovals, ...payrollApprovals, "finance.year-close": YearCloseService.handler({ checks: FINANCE_CHECKS, blockers: CLOSE_BLOCKERS }) };
