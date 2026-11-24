import { and, eq, inArray } from "drizzle-orm";
import { auditLogs, type Tx } from "@smw/db";
import { NotFoundError } from "@smw/feature-kit";
import type { Approval, ApprovalHandlers } from "@smw/feature-finance/approvals";
import { approveExit } from "./exit-ledger";
import { approveRun, recallRun } from "./ledger";
import { payExits, payItems, payLoans, payRuns } from "./schema";

const asRequester = (a: { schoolId: string; requestedBy: string }) => ({ schoolId: a.schoolId, userId: a.requestedBy });
/** Audit actions that change an amount on a run. */
const AMOUNT_EDITS = ["adjust", "remove_adjustment", "type_amount", "set_days"];

/** Who made a run or typed an amount on it. A payee is counted only through their own edits, not for being paid. */
async function runInvolved(tx: Tx, a: Approval): Promise<(string | null)[]> {
  const [run] = await tx.select({ by: payRuns.createdBy }).from(payRuns).where(eq(payRuns.id, a.refId));
  const items = await tx.select({ id: payItems.id }).from(payItems).where(eq(payItems.runId, a.refId));
  const edits = items.length ? await tx.select({ by: auditLogs.actorUserId }).from(auditLogs).where(and(eq(auditLogs.module, "payroll"), eq(auditLogs.entity, "PayItem"), inArray(auditLogs.entityId, items.map((i) => i.id)), inArray(auditLogs.action, AMOUNT_EDITS))) : [];
  return [run?.by ?? null, ...edits.map((e) => e.by)];
}

/** What deciding a payroll request does. Entries post as the person who asked, so the ledger shows the maker. Rejecting or withdrawing leaves each document in a state that can be changed and sent again. */
export const payrollApprovals: ApprovalHandlers = {
  "payroll.run": {
    async approve(tx, a, actor) { await approveRun(tx, asRequester(a), a.refId, actor.userId); },
    async reject(tx, a) { await tx.update(payRuns).set({ status: "draft" }).where(and(eq(payRuns.id, a.refId), eq(payRuns.status, "reviewed"))); },
    involved: runInvolved,
  },
  "payroll.recall": { async approve(tx, a) { await recallRun(tx, asRequester(a), a.refId, a.reason); }, involved: runInvolved },
  "payroll.loan": {
    async approve(tx, a) {
      const [l] = await tx.update(payLoans).set({ status: "active" }).where(eq(payLoans.id, a.refId)).returning({ id: payLoans.id });
      if (!l) throw new NotFoundError("Loan");
    },
    async reject(tx, a) { await tx.update(payLoans).set({ status: "rejected" }).where(and(eq(payLoans.id, a.refId), eq(payLoans.status, "pending"))); },
    async involved(tx, a) { const [l] = await tx.select({ userId: payLoans.userId, by: payLoans.createdBy }).from(payLoans).where(eq(payLoans.id, a.refId)); return [l?.userId ?? null, l?.by ?? null]; },
  },
  "payroll.exit": {
    async approve(tx, a, actor) { await approveExit(tx, asRequester(a), a.refId, actor.userId); },
    async reject(tx, a) { await tx.update(payExits).set({ status: "rejected" }).where(and(eq(payExits.id, a.refId), eq(payExits.status, "pending"))); },
    async withdraw(tx, a) { await tx.update(payExits).set({ status: "draft" }).where(and(eq(payExits.id, a.refId), eq(payExits.status, "pending"))); },
    async involved(tx, a) { const [x] = await tx.select({ userId: payExits.userId, by: payExits.createdBy }).from(payExits).where(eq(payExits.id, a.refId)); return [x?.userId ?? null, x?.by ?? null]; },
  },
};
