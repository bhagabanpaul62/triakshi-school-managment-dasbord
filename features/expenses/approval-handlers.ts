import { eq } from "drizzle-orm";
import { ConflictError, NotFoundError } from "@smw/feature-kit";
import { todayIST } from "@smw/feature-kit/money";
import type { ApprovalHandlers } from "@smw/feature-finance/approvals";
import { reverseJournal } from "@smw/feature-finance/posting";
import { loadFinanceSettings } from "@smw/feature-finance/settings";
import { approveBill } from "./bills";
import { approveClaim } from "./claims";
import { reverseIncome } from "./income";
import { reversePayment } from "./payments";
import { expBills, expClaims } from "./schema";

/** What deciding an expenses request does. They post as the person who asked, so the ledger shows the maker. */
export const expensesApprovals: ApprovalHandlers = {
  "expenses.bill": {
    async approve(tx, a) { await approveBill(tx, { schoolId: a.schoolId, userId: a.requestedBy }, a.refId, (await loadFinanceSettings(tx)).basis); },
    async reject(tx, a) {
      const [b] = await tx.select().from(expBills).where(eq(expBills.id, a.refId)).for("update");
      if (!b) throw new NotFoundError("Bill");
      if (b.status === "pending") await tx.update(expBills).set({ status: "rejected" }).where(eq(expBills.id, a.refId));
    },
  },
  "expenses.claim": {
    async approve(tx, a) { await approveClaim(tx, { schoolId: a.schoolId, userId: a.requestedBy }, a.refId); },
    async reject(tx, a) { await tx.update(expClaims).set({ status: "rejected" }).where(eq(expClaims.id, a.refId)); },
  },
  "expenses.reversal": {
    async approve(tx, a) {
      const by = { schoolId: a.schoolId, userId: a.requestedBy }, memo = `Undo of ${a.title.replace(/^Reverse /, "")}: ${a.reason}`;
      if (a.refType === "exp_payment") await reversePayment(tx, by, a.refId, memo, a.reason, todayIST());
      else if (a.refType === "exp_income") await reverseIncome(tx, (key, m) => reverseJournal(tx, by, key, { date: todayIST(), memo: m }), a.refId, a.reason);
      else throw new ConflictError("Unknown thing to reverse.");
    },
  },
};
