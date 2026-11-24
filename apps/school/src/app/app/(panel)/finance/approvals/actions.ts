"use server";

import { ApprovalService } from "@smw/feature-finance/approvals";
import { ApprovalDeskService } from "@smw/feature-finance/services/approval-desk";
import { actionCtx, formToObject, runAction } from "@smw/runtime";
import { APPROVAL_HANDLERS } from "@/lib/approval-handlers";

const decide = (fd: FormData, how: "approve" | "reject", message: string) =>
  runAction(async () => new ApprovalService(await actionCtx(), APPROVAL_HANDLERS)[how](formToObject(fd)).then((r) => ({ id: r.id })), message);

/** Anyone who asked may take a request back, so this does not need the approve grant. */
export async function withdraw(fd: FormData) {
  return runAction(async () => new ApprovalDeskService(await actionCtx(), APPROVAL_HANDLERS).withdraw(String(fd.get("id"))).then((r) => ({ id: r.id })), "Request withdrawn");
}
export async function approve(fd: FormData) { return decide(fd, "approve", "Approved"); }
export async function reject(fd: FormData) { return decide(fd, "reject", "Rejected"); }
