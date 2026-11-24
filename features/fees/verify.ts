import { eq } from "drizzle-orm";
import type { VerifyFound, VerifyLookup, VerifyLookups } from "@smw/feature-finance/templates/verify";
import { openOf } from "./calc";
import { feeInvoices, feeReceipts } from "./schema";

const RECEIPT_STATUS: Record<string, { status: string; ok: boolean }> = {
  valid: { status: "Valid", ok: true }, clearing: { status: "Valid, cheque not cleared yet", ok: true }, reversed: { status: "Reversed", ok: false }, bounced: { status: "Cheque bounced", ok: false },
};

/** The public check page's view of a receipt, found by its random token. Only what the page may show. */
export const receiptLookup: VerifyLookup = async (tx, token): Promise<VerifyFound | null> => {
  const [r] = await tx.select().from(feeReceipts).where(eq(feeReceipts.verifyToken, token));
  if (!r) return null;
  const s = RECEIPT_STATUS[r.status] ?? { status: r.status, ok: false };
  return { ...s, number: r.number, date: r.date, amountPaise: r.amountPaise, studentName: r.snapshot.studentName };
};

export const invoiceLookup: VerifyLookup = async (tx, token): Promise<VerifyFound | null> => {
  const [i] = await tx.select().from(feeInvoices).where(eq(feeInvoices.verifyToken, token));
  if (!i || !i.number || !i.issueDate) return null;
  const status = i.status === "cancelled" ? { status: "Cancelled", ok: false } : openOf(i) <= 0 ? { status: "Paid", ok: true } : { status: "Issued", ok: true };
  return { ...status, number: i.number, date: i.issueDate, amountPaise: i.grossPaise - i.concessionPaise, studentName: i.snapshot.studentName };
};

/** Pass this to the app's public check route, merged with the other modules'. */
export const feesVerifyLookups: VerifyLookups = { receipt: receiptLookup, invoice: invoiceLookup };
