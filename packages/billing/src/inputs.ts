import { z } from "zod";
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
});
