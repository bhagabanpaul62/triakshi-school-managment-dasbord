import { systemCtx } from "@smw/feature-kit";
import { ChecksService } from "@smw/feature-fees/service";
import type { ControlCheck } from "@smw/feature-finance/services/control";

/** The ledger checks of the other money modules, composed here once for the dashboard and the year close. */
export const FINANCE_CHECKS: ControlCheck[] = [
  { name: "Fees", run: async (tx, schoolId) => (await new ChecksService(systemCtx(schoolId, ["fees", "finance"])).runIn(tx)).map((m) => m.message) },
];
/** Anything else that must be finished before a year closes. Each problem returned blocks the close. */
export const CLOSE_BLOCKERS: ControlCheck[] = [];
