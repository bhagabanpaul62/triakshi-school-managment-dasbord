import type { ApprovalHandlers } from "@smw/feature-finance/approvals";
import { ConcessionService } from "./concessions";
import { NoteService } from "./notes";
import { PlanService } from "./plans";
import { ReceiptService } from "./receipts";
import { RefundService } from "./refunds";
import { SettlementService } from "./settlements";

/** What happens when each fee request is decided. They run inside the deciding transaction; a refusal rolls the decision back. */
export const feesApprovals: ApprovalHandlers = {
  "fees.plan": { approve: (tx, a, actor) => new PlanService(actor).publishIn(tx, a.refId), reject: (tx, a, actor) => new PlanService(actor).rejectIn(tx, a.refId) },
  "fees.concession": { approve: async (tx, a, actor) => { await new ConcessionService(actor).approveIn(tx, a.refId); }, reject: (tx, a, actor) => new ConcessionService(actor).rejectIn(tx, a.refId) },
  "fees.note": { approve: async (tx, a, actor) => { await new NoteService(actor).applyIn(tx, a.refId); }, reject: (tx, a, actor) => new NoteService(actor).rejectIn(tx, a.refId) },
  "fees.settlement": { approve: async (tx, a, actor) => { await new SettlementService(actor).approveIn(tx, a.refId); }, reject: (tx, a, actor) => new SettlementService(actor).rejectIn(tx, a.refId) },
  "fees.refund": { approve: async (tx, a, actor) => { await new RefundService(actor).approveIn(tx, a.refId); }, reject: (tx, a, actor) => new RefundService(actor).rejectIn(tx, a.refId) },
  // A refused reversal changes nothing: the receipt stands, and the request keeps the reason.
  "fees.reversal": { approve: (tx, a, actor) => new ReceiptService(actor).reverseIn(tx, a.refId, a.reason) },
};
