import { eq } from "drizzle-orm";
import type { ApprovalHandlers } from "@smw/feature-finance/approvals";
import { ChangeService } from "./changes";
import { CounterService } from "./counter";
import { ConcessionService } from "./concessions";
import { InvoiceService } from "./invoices";
import { NoteService } from "./notes";
import { OpeningImport } from "./opening";
import { PlanService } from "./plans";
import { ReceiptService } from "./receipts";
import { RefundService } from "./refunds";
import { feeCounters, feePlans } from "./schema";
import { SettlementService } from "./settlements";

/** What happens when each fee request is decided. They run inside the deciding transaction; a refusal rolls the decision back. */
export const feesApprovals: ApprovalHandlers = {
  "fees.plan": { approve: (tx, a, actor) => new PlanService(actor).publishIn(tx, a.refId), reject: (tx, a, actor) => new PlanService(actor).rejectIn(tx, a.refId), involved: async (tx, a) => (await tx.select({ id: feePlans.createdBy }).from(feePlans).where(eq(feePlans.id, a.refId))).map((r) => r.id) },
  "fees.concession": { approve: async (tx, a, actor) => { await new ConcessionService(actor).approveIn(tx, a.refId); }, reject: (tx, a, actor) => new ConcessionService(actor).rejectIn(tx, a.refId) },
  "fees.note": { approve: async (tx, a, actor) => { await new NoteService(actor).applyIn(tx, a.refId); }, reject: (tx, a, actor) => new NoteService(actor).rejectIn(tx, a.refId) },
  "fees.settlement": { approve: async (tx, a, actor) => { await new SettlementService(actor).approveIn(tx, a.refId); }, reject: (tx, a, actor) => new SettlementService(actor).rejectIn(tx, a.refId) },
  "fees.refund": { approve: async (tx, a, actor) => { await new RefundService(actor).approveIn(tx, a.refId); }, reject: (tx, a, actor) => new RefundService(actor).rejectIn(tx, a.refId) },
  "fees.invoice_change": {
    approve: async (tx, a, actor) => {
      const c = await new ChangeService(actor).takeIn(tx, a.refId);
      const bills = new InvoiceService(actor), plans = new PlanService(actor);
      const p = c.payload as never;
      if (c.kind === "cancel") await bills.cancelIn(tx, c.invoiceId!, c.reason);
      else if (c.kind === "revise") await bills.reviseIn(tx, c.invoiceId!, p);
      else if (c.kind === "student_plan") await plans.applyStudentPlanIn(tx, p);
      else if (c.kind === "opt_out") await plans.applyOptInsIn(tx, p);
      else if (c.kind === "archive_plan") await plans.archiveIn(tx, (c.payload as { planId: string }).planId);
    },
    reject: (tx, a, actor) => new ChangeService(actor).rejectIn(tx, a.refId),
  },
  "fees.opening": { approve: (tx, a, actor) => new OpeningImport(actor).approveIn(tx, a.refId, new InvoiceService(actor)), reject: (tx, a, actor) => new OpeningImport(actor).rejectIn(tx, a.refId) },
  "fees.counter_difference": { approve: (tx, a, actor) => new CounterService(actor).decideIn(tx, a.refId, true), reject: (tx, a, actor) => new CounterService(actor).decideIn(tx, a.refId, false), withdraw: (tx, a, actor) => new CounterService(actor).withdrawIn(tx, a.refId), involved: async (tx, a) => (await tx.select({ id: feeCounters.userId }).from(feeCounters).where(eq(feeCounters.id, a.refId))).map((r) => r.id) },
  // A refused reversal changes nothing: the receipt stands, and the request keeps the reason.
  "fees.reversal": { approve: (tx, a, actor) => new ReceiptService(actor).reverseIn(tx, a.refId, a.reason) },
};
