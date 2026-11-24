import { addDays, apportion, fyOf, fyRange, percentOf } from "@smw/feature-kit/money";

/** The money fields of an invoice that decide what is still owed. Pure, so the console form can preview with it. */
export interface InvoiceMoney { status: string; totalPaise: number; creditedPaise: number; creditAppliedPaise: number }
export interface GstParts { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number }

/** What the school still owes on an invoice. Credit notes and account credit lower it; the invoice total never changes. */
export const dueOf = (inv: InvoiceMoney) => (inv.status === "issued" ? inv.totalPaise - inv.creditedPaise - inv.creditAppliedPaise : 0);

/** What is left of an invoice's value to credit: its total minus the credit notes already issued. */
export const creditableOf = (inv: Pick<InvoiceMoney, "status" | "totalPaise" | "creditedPaise">) =>
  inv.status === "issued" || inv.status === "paid" ? inv.totalPaise - inv.creditedPaise : 0;

/** Cash that went in for an invoice and can still go back: total less credit notes, account credit used and tax withheld. */
export const refundableOf = (inv: InvoiceMoney & { tdsPaise: number }) => inv.totalPaise - inv.creditedPaise - inv.creditAppliedPaise - inv.tdsPaise;

/** A school may withhold at most 10% of what it owes. */
export const maxTds = (duePaise: number) => percentOf(duePaise, 1000);

/**
 * Split a credit note's total over taxable, CGST, SGST and IGST in proportion to what is left of the invoice, to the paisa.
 * The last note takes exactly what remains, so all notes together equal the invoice.
 */
export function splitCredit(left: GstParts, amountPaise: number): GstParts {
  if (!Number.isInteger(amountPaise) || amountPaise < 1) throw new RangeError("Credit must be whole paise");
  if (amountPaise > left.totalPaise) throw new RangeError("Credit is more than what is left");
  if (amountPaise === left.totalPaise) return { ...left };
  const [taxablePaise, cgstPaise, sgstPaise, igstPaise] = apportion(amountPaise, [left.taxablePaise, left.cgstPaise, left.sgstPaise, left.igstPaise]) as [number, number, number, number];
  return { taxablePaise, cgstPaise, sgstPaise, igstPaise, totalPaise: amountPaise };
}

/** The Indian financial quarter a day falls in, and the day to remind about its certificate (45 days after the quarter ends). */
export function tdsQuarter(day: string): { label: string; remindOn: string } {
  const fy = fyOf(day);
  const [start] = fyRange(fy);
  const months = (+day.slice(0, 4) - +start.slice(0, 4)) * 12 + (+day.slice(5, 7) - 4);
  const q = Math.floor(months / 3) + 1;
  const endMonth = new Date(Date.UTC(+start.slice(0, 4), 3 + q * 3, 1)).toISOString().slice(0, 10); // first day after the quarter
  return { label: `${fy} Q${q}`, remindOn: addDays(endMonth, -1 + 45) };
}

/** The state a person sees for an invoice, as StateBadge words. */
export function invoiceStateOf(inv: { status: string; dueAt: Date | string | null }, now = new Date()): "paid" | "cancelled" | "overdue" | "due" | "draft" {
  if (inv.status === "paid") return "paid";
  if (inv.status === "void") return "cancelled";
  if (inv.status === "draft") return "draft";
  return inv.dueAt && new Date(inv.dueAt) < now ? "overdue" : "due";
}
