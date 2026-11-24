import { eq } from "drizzle-orm";
import { NotFoundError } from "@smw/feature-kit";
import { todayIST } from "@smw/feature-kit/money";
import type { ApprovalHandlers } from "./approvals";
import { postJournal, reverseJournal } from "./posting";
import { finJournalDrafts, finJournals } from "./schema";

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
};
