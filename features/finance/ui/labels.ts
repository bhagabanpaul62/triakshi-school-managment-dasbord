import type { Tone } from "@smw/ui/widgets/WidgetPrimitives";
import type { JOURNAL_KINDS } from "../schema";

/** Plain names for approval kinds. Other modules add theirs here when they register a handler. */
export const APPROVAL_KIND_LABEL: Record<string, string> = {
  "finance.journal": "Manual journal entries",
  "finance.reverse": "Undo requests",
  "finance.bank-entry": "Bank entries",
  "finance.year-reopen": "Year reopen requests",
  "fees.plan": "Fee plans",
  "fees.concession": "Concessions",
  "fees.note": "Credit and debit notes",
  "fees.settlement": "Settlements",
  "fees.reversal": "Receipt reversals",
  "fees.opening": "Opening balances",
  "fees.counter_difference": "Counter differences",
  "fees.invoice_change": "Bill changes",
  "fees.refund": "Refunds",
  "expenses.bill": "Vendor bills",
  "expenses.claim": "Staff claims",
  "expenses.reversal": "Payment reversals",
  "payroll.run": "Payroll runs",
  "payroll.recall": "Payroll recalls",
  "payroll.loan": "Staff loans",
  "payroll.exit": "Exit settlements",
};
export const kindLabel = (kind: string) => APPROVAL_KIND_LABEL[kind] ?? kind.replace(/[._]/g, " ");

export const JOURNAL_KIND_LABEL: Record<(typeof JOURNAL_KINDS)[number], string> = { auto: "Automatic", manual: "Manual", transfer: "Transfer", opening: "Opening", reversal: "Undo" };
export const JOURNAL_KIND_TONE: Record<string, Tone> = { auto: "default", manual: "info", transfer: "default", opening: "default", reversal: "warning" };

export const ACCOUNT_TYPE_LABEL = { asset: "Assets", liability: "Liabilities", equity: "Funds", income: "Income", expense: "Expenses" } as const;

/** "Apr 2026" from "2026-04-01". */
export const monthLabel = (m: string) => new Date(`${m}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
