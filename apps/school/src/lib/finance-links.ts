/** Where a journal entry's source document opens, by the `sourceType` each module posts with. An unknown type shows as plain text. */
const ROUTES: Record<string, (id: string) => string> = {
  manual: () => "/app/finance/approvals?status=approved",
  "bank-line": () => "/app/finance/banking",
  fee_invoice: (id) => `/app/fees/invoices/${id}`,
  fee_note: (id) => `/app/fees/invoices/${id}`,
  fee_receipt: (id) => `/app/fees/receipts/${id}`,
  fee_student: (id) => `/app/fees/students/${id}`,
  fee_counter: () => "/app/fees/counter",
  exp_bill: (id) => `/app/expenses/bills?open=${id}`,
  exp_payment: (id) => `/app/expenses/payments?id=${id}`,
  exp_income: (id) => `/app/expenses/income?id=${id}`,
  exp_petty: (id) => `/app/expenses/petty?id=${id}`,
  exp_claim: (id) => `/app/expenses/claims?id=${id}`,
  payroll_run: (id) => `/app/payroll/runs/${id}`,
  payroll_payout: (id) => `/app/payroll/runs/${id}?tab=payouts`,
  payroll_loan: (id) => `/app/payroll/loans?item=${id}`,
  payroll_remittance: () => "/app/payroll/statutory?tab=remittances",
  opening: () => "/app/finance/banking",
  transfer: () => "/app/finance/banking",
  "year-close": () => "/app/finance/year-close",
};

export function sourceHref(sourceType: string, sourceId: string | null): string | null {
  return sourceId ? ROUTES[sourceType]?.(sourceId) ?? null : null;
}
