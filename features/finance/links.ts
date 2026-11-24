/** Where the other money modules keep their lists. Finance links to them and never imports them; change a route here and every link follows. */
export const MODULE_LINKS = {
  feeSetup: "/app/fees/heads",
  plans: "/app/fees/plans",
  invoices: "/app/fees/invoices",
  dues: "/app/fees/dues",
  receipts: "/app/fees/receipts",
  counter: "/app/fees/counter",
  bills: "/app/expenses/bills",
  budgets: "/app/expenses/budgets",
  recurring: "/app/expenses/recurring",
  payroll: "/app/payroll",
} as const;

/** The ledger of one account, for a day range or up to a day. */
export const ledgerLink = (accountId: string, range?: { from?: string; to?: string }) => {
  const q = new URLSearchParams();
  if (range?.from) q.set("from", range.from);
  if (range?.to) q.set("to", range.to);
  return `/app/finance/accounts/${accountId}${q.size ? `?${q}` : ""}`;
};
