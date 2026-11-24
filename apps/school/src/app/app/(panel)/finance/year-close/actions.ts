"use server";

import { YearCloseService } from "@smw/feature-finance/services/year-close";
import { actionCtx, formToObject, runAction } from "@smw/runtime";
import { CLOSE_BLOCKERS, FINANCE_CHECKS } from "@/lib/finance-checks";

const service = async () => new YearCloseService(await actionCtx(), { checks: FINANCE_CHECKS, blockers: CLOSE_BLOCKERS });

export async function closeYear(fd: FormData) {
  return runAction(async () => (await service()).run(String(fd.get("fy"))).then((r) => ({ id: r.journalId ?? r.fy })), "Year closed");
}
export async function requestReopen(fd: FormData) {
  return runAction(async () => (await service()).requestReopen(String(fd.get("fy")), formToObject(fd)).then((r) => ({ id: r.approvalId })), "Sent for approval");
}
