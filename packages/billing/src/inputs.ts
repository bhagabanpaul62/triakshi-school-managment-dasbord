import { z } from "zod";
import { CREDIT_NOTE_KINDS } from "@smw/db";
import { f } from "@smw/feature-kit";

export const checkoutInput = z.object({
  planKey: f.text(1, 40, "Pick a plan"),
  interval: z.enum(["annual", "monthly"], { message: "Choose annual or monthly" }),
});

export const OFFLINE_METHODS = ["bank_transfer", "cheque", "cash", "upi"] as const;
export const offlinePaymentInput = z.object({
  invoiceId: f.id("Choose an invoice"),
  amountPaise: f.paise(1),
  method: z.enum(OFFLINE_METHODS, { message: "Choose how it was paid" }),
  reference: f.optText(100),
  paidOn: f.optDate(),
  /** Tax the school withheld. Cash plus this must equal what the invoice needs. */
  tdsPaise: f.optInt(0, 100_000_000_000),
});

const refundDetails = {
  refundMethod: z.enum(OFFLINE_METHODS, { message: "Choose how it was paid back" }).optional(),
  refundReference: f.optText(100),
  refundedOn: f.optDate(),
};
export const creditNoteInput = z.object({
  invoiceId: f.id("Choose an invoice"),
  amountPaise: f.paise(1),
  kind: z.enum(CREDIT_NOTE_KINDS, { message: "Choose why it is being credited" }),
  reason: f.text(3, 300, "Say why this credit note is needed"),
  /** For a paid invoice: money back, or credit for the next invoice. Unpaid invoices simply owe less. */
  settle: z.enum(["refund", "credit"]).optional(),
  ...refundDetails,
});
export const refundInput = z.object({
  creditNoteId: f.id("Choose a credit note"),
  method: z.enum(OFFLINE_METHODS, { message: "Choose how it was paid back" }),
  reference: f.optText(100),
  paidOn: f.optDate(),
});
export const cancelInvoiceInput = z.object({ invoiceId: f.id("Choose an invoice"), reason: f.text(3, 300, "Say why it is cancelled") });
