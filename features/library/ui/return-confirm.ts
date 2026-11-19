import { paise } from "@smw/ui/format";

/** Asks first only when a fine is due, and says exactly how much and from whom. */
export function returnConfirm(r: { title: string; borrowerName: string; daysLate: number; finePaise: number }) {
  if (r.finePaise <= 0) return undefined;
  return {
    title: "Take this book back?",
    body: `${r.title} is ${r.daysLate} ${r.daysLate === 1 ? "day" : "days"} late. ${r.borrowerName} owes a fine of ${paise(r.finePaise)}. Collect it at the desk, or waive it from Loans.`,
    confirmLabel: `Return, fine ${paise(r.finePaise)}`,
  };
}
