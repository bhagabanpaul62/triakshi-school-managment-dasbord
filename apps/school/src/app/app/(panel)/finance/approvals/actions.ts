"use server";

import { ApprovalService } from "@smw/feature-finance/approvals";
import { actionCtx, formToObject, runAction } from "@smw/runtime";
import { APPROVAL_HANDLERS } from "@/lib/approval-handlers";

const decide = (fd: FormData, how: "approve" | "reject", message: string) =>
  runAction(async () => new ApprovalService(await actionCtx(), APPROVAL_HANDLERS)[how](formToObject(fd)).then((r) => ({ id: r.id })), message);

export async function approve(fd: FormData) { return decide(fd, "approve", "Approved"); }
export async function reject(fd: FormData) { return decide(fd, "reject", "Rejected"); }
