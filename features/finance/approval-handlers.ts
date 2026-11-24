import { and, eq } from "drizzle-orm";
import { ConflictError, NotFoundError } from "@smw/feature-kit";
import { todayIST } from "@smw/feature-kit/money";
import type { ApprovalHandlers } from "./approvals";
import { postJournal, reverseJournal } from "./posting";
import { finBankDrafts, finBankLines, finCashAccounts, finJournalDrafts, finJournalLines, finJournals } from "./schema";
import { reopenYear } from "./services/year-close";

/** What deciding a finance request does. Both post as the person who asked, so the ledger shows the maker. */
export const financeApprovals: ApprovalHandlers = {
  "finance.journal": {
    async approve(tx, a) {
      const [d] = await tx.select().from(finJournalDrafts).where(eq(finJournalDrafts.id, a.refId)).limit(1);
      if (!d) throw new NotFoundError("Journal draft");
      await postJournal(tx, { schoolId: a.schoolId, userId: a.requestedBy }, {
        date: d.date, sourceKey: `finance:manual:${d.id}`, sourceType: "manual", sourceId: d.id, kind: "manual", memo: d.memo,
        lines: d.lines.map((l) => ({ account: { id: l.accountId }, debit: l.debitPaise, credit: l.creditPaise, costCentreId: l.costCentreId, memo: l.memo })),
      });
    },
  },
  "finance.reverse": {
    async approve(tx, a) {
      const [j] = await tx.select().from(finJournals).where(eq(finJournals.id, a.refId)).for("update");
      if (!j) throw new NotFoundError("Journal entry");
      await reverseJournal(tx, { schoolId: a.schoolId, userId: a.requestedBy }, j.sourceKey, { date: todayIST(), memo: `Undo of ${j.number}: ${a.reason}` });
    },
  },
  /** A bank line recorded as another entry: post the draft as the person who asked, then match the line to it. */
  "finance.bank-entry": {
    async approve(tx, a) {
      const [bank] = await tx.select().from(finBankLines).where(eq(finBankLines.id, a.refId)).for("update");
      if (!bank) throw new NotFoundError("Bank line");
      if (bank.matchedAt) throw new ConflictError("This bank line was matched to something else meanwhile. Reject this request.");
      const [link] = await tx.select().from(finBankDrafts).where(eq(finBankDrafts.bankLineId, bank.id));
      const [d] = link ? await tx.select().from(finJournalDrafts).where(eq(finJournalDrafts.id, link.draftId)) : [];
      const [cash] = await tx.select().from(finCashAccounts).where(eq(finCashAccounts.id, bank.cashAccountId));
      if (!d || !cash) throw new NotFoundError("Journal draft");
      const posted = await postJournal(tx, { schoolId: a.schoolId, userId: a.requestedBy }, {
        date: d.date, sourceKey: `finance:manual:${d.id}`, sourceType: "manual", sourceId: d.id, kind: "manual", memo: d.memo,
        lines: d.lines.map((l) => ({ account: { id: l.accountId }, debit: l.debitPaise, credit: l.creditPaise, costCentreId: l.costCentreId, memo: l.memo })),
      });
      const [mine] = await tx.select({ id: finJournalLines.id }).from(finJournalLines).where(and(eq(finJournalLines.journalId, posted!.id), eq(finJournalLines.accountId, cash.accountId))).limit(1);
      await tx.update(finBankLines).set({ journalLineId: mine!.id, matchedBy: a.requestedBy, matchedAt: new Date() }).where(eq(finBankLines.id, bank.id));
    },
    /** Free the line so it can be recorded again. */
    async reject(tx, a) { await tx.delete(finBankDrafts).where(eq(finBankDrafts.bankLineId, a.refId)); },
  },
  "finance.year-reopen": {
    async approve(tx, a) { await reopenYear(tx, { schoolId: a.schoolId, userId: a.requestedBy }, a.refId, a.reason); },
  },
};
