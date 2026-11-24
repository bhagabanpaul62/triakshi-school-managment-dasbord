import { eq } from "drizzle-orm";
import { NotFoundError } from "@smw/feature-kit";
import type { ApprovalHandlers } from "@smw/feature-finance/approvals";
import { approveExit } from "./exit-ledger";
import { approveRun, recallRun } from "./ledger";
import { payExits, payLoans, payRuns } from "./schema";

const asRequester = (a: { schoolId: string; requestedBy: string }) => ({ schoolId: a.schoolId, userId: a.requestedBy });

/** What deciding a payroll request does. Entries post as the person who asked, so the ledger shows the maker. */
export const payrollApprovals: ApprovalHandlers = {
  "payroll.run": {
    async approve(tx, a, actor) { await approveRun(tx, asRequester(a), a.refId, actor.userId); },
    async reject(tx, a) { await tx.update(payRuns).set({ status: "draft" }).where(eq(payRuns.id, a.refId)); },
  },
  "payroll.recall": { async approve(tx, a) { await recallRun(tx, asRequester(a), a.refId, a.reason); } },
  "payroll.loan": {
    async approve(tx, a) {
      const [l] = await tx.update(payLoans).set({ status: "active" }).where(eq(payLoans.id, a.refId)).returning({ id: payLoans.id });
      if (!l) throw new NotFoundError("Loan");
    },
    async reject(tx, a) { await tx.update(payLoans).set({ status: "rejected" }).where(eq(payLoans.id, a.refId)); },
  },
  "payroll.exit": {
    async approve(tx, a, actor) { await approveExit(tx, asRequester(a), a.refId, actor.userId); },
    async reject(tx, a) { await tx.update(payExits).set({ status: "rejected" }).where(eq(payExits.id, a.refId)); },
  },
};
