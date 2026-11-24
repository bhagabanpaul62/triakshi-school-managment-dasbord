import { and, eq } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, NotFoundError } from "@smw/feature-kit";
import { todayIST } from "@smw/feature-kit/money";
import type { ApprovalHandlers } from "@smw/feature-finance/approvals";
import { reverseJournal } from "@smw/feature-finance/posting";
import { loadFinanceSettings } from "@smw/feature-finance/settings";
import { approveBill } from "./bills";
import { approveClaim } from "./claims";
import { reverseIncome } from "./income";
import { reversePayment } from "./payments";
import { expBills, expClaims, expIncome, expPayments } from "./schema";

/** A bill that is still waiting moves to `to`; one already decided stays as it is. */
async function settleBill(tx: Tx, id: string, to: "rejected" | "draft") {
  const [b] = await tx.select().from(expBills).where(eq(expBills.id, id)).for("update");
  if (!b) throw new NotFoundError("Bill");
  if (b.status === "pending") await tx.update(expBills).set({ status: to }).where(eq(expBills.id, id));
}

/** What deciding an expenses request does. They post as the person who asked, so the ledger shows the maker. */
export const expensesApprovals: ApprovalHandlers = {
  "expenses.bill": {
    async approve(tx, a) { await approveBill(tx, { schoolId: a.schoolId, userId: a.requestedBy }, a.refId, (await loadFinanceSettings(tx)).basis); },
    async reject(tx, a) { await settleBill(tx, a.refId, "rejected"); },
    // Taking it back returns the bill to a draft the maker can change and send again.
    async withdraw(tx, a) { await settleBill(tx, a.refId, "draft"); },
    async involved(tx, a) { return (await tx.select({ by: expBills.createdBy }).from(expBills).where(eq(expBills.id, a.refId))).map((r) => r.by); },
  },
  "expenses.claim": {
    async approve(tx, a) { await approveClaim(tx, { schoolId: a.schoolId, userId: a.requestedBy }, a.refId); },
    async reject(tx, a) { await tx.update(expClaims).set({ status: "rejected" }).where(eq(expClaims.id, a.refId)); },
    // A rejected claim is the one the claimant can edit and send again.
    async withdraw(tx, a) { await tx.update(expClaims).set({ status: "rejected" }).where(and(eq(expClaims.id, a.refId), eq(expClaims.status, "submitted"))); },
    async involved(tx, a) { return (await tx.select({ by: expClaims.userId }).from(expClaims).where(eq(expClaims.id, a.refId))).map((r) => r.by); },
  },
  "expenses.reversal": {
    async approve(tx, a) {
      const by = { schoolId: a.schoolId, userId: a.requestedBy }, memo = `Undo of ${a.title.replace(/^Reverse /, "")}: ${a.reason}`;
      if (a.refType === "exp_payment") await reversePayment(tx, by, a.refId, memo, a.reason, todayIST());
      else if (a.refType === "exp_income") await reverseIncome(tx, (key, m) => reverseJournal(tx, by, key, { date: todayIST(), memo: m }), a.refId, a.reason);
      else throw new ConflictError("Unknown thing to reverse.");
    },
    async involved(tx, a) {
      const table = a.refType === "exp_payment" ? expPayments : a.refType === "exp_income" ? expIncome : null;
      return table ? (await tx.select({ by: table.createdBy }).from(table).where(eq(table.id, a.refId))).map((r) => r.by) : [];
    },
  },
};
