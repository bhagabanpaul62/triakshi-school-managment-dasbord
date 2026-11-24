import { and, eq, isNotNull } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { finAccounts, type ACCOUNT_TYPES } from "./schema";

type Row = { key: string; code: string; name: string; type: (typeof ACCOUNT_TYPES)[number]; group: string };
/** The accounts the product posts to. `concessions` is an income account that normally carries a debit. */
export const SYSTEM_ACCOUNTS = [
  { key: "cash", code: "1000", name: "Cash in hand", type: "asset", group: "Cash and bank" },
  { key: "bank", code: "1010", name: "Bank", type: "asset", group: "Cash and bank" },
  { key: "cheques", code: "1020", name: "Cheques in hand", type: "asset", group: "Cash and bank" },
  { key: "student_dues", code: "1100", name: "Student dues", type: "asset", group: "Receivables" },
  { key: "govt_due", code: "1110", name: "Government reimbursement due", type: "asset", group: "Receivables" },
  { key: "staff_loans", code: "1120", name: "Staff loans and advances", type: "asset", group: "Receivables" },
  { key: "petty_cash", code: "1130", name: "Petty cash with staff", type: "asset", group: "Cash and bank" },
  { key: "fixed_assets", code: "1500", name: "Fixed assets", type: "asset", group: "Fixed assets" },
  { key: "deposits_payable", code: "2000", name: "Student deposits", type: "liability", group: "Payables" },
  { key: "student_advances", code: "2010", name: "Student advances", type: "liability", group: "Payables" },
  { key: "vendor_dues", code: "2020", name: "Vendor dues", type: "liability", group: "Payables" },
  { key: "salary_payable", code: "2030", name: "Salaries payable", type: "liability", group: "Payables" },
  { key: "claims_payable", code: "2040", name: "Staff claims payable", type: "liability", group: "Payables" },
  { key: "pf_payable", code: "2100", name: "Provident fund payable", type: "liability", group: "Statutory dues" },
  { key: "esi_payable", code: "2110", name: "ESI payable", type: "liability", group: "Statutory dues" },
  { key: "pt_payable", code: "2120", name: "Professional tax payable", type: "liability", group: "Statutory dues" },
  { key: "tds_payable", code: "2130", name: "TDS payable", type: "liability", group: "Statutory dues" },
  { key: "lwf_payable", code: "2140", name: "Labour welfare fund payable", type: "liability", group: "Statutory dues" },
  { key: "other_deductions", code: "2150", name: "Other salary deductions", type: "liability", group: "Statutory dues" },
  { key: "gratuity_payable", code: "2160", name: "Gratuity payable", type: "liability", group: "Payables" },
  { key: "opening", code: "3000", name: "Opening balances", type: "equity", group: "Funds" },
  { key: "surplus", code: "3010", name: "Accumulated surplus", type: "equity", group: "Funds" },
  { key: "fee_income", code: "4000", name: "Fee income", type: "income", group: "Fees" },
  { key: "concessions", code: "4010", name: "Fee concessions", type: "income", group: "Fees" },
  { key: "late_fee", code: "4020", name: "Late fee", type: "income", group: "Fees" },
  { key: "govt_income", code: "4030", name: "Government reimbursement", type: "income", group: "Other income" },
  { key: "other_income", code: "4090", name: "Other income", type: "income", group: "Other income" },
  { key: "salaries", code: "5000", name: "Salaries", type: "expense", group: "People" },
  { key: "employer_contrib", code: "5010", name: "Employer contributions", type: "expense", group: "People" },
  { key: "bank_charges", code: "5020", name: "Bank charges", type: "expense", group: "Office" },
  { key: "bad_debts", code: "5030", name: "Fees written off", type: "expense", group: "Fees" },
  { key: "cash_difference", code: "5040", name: "Cash differences", type: "expense", group: "Office" },
  { key: "general_expense", code: "5090", name: "General expenses", type: "expense", group: "Office" },
] as const satisfies readonly Row[];
export type SystemAccount = (typeof SYSTEM_ACCOUNTS)[number]["key"];

/** Everyday accounts a new school also gets; the school may rename or switch these off. */
const STARTER = [
  ["5100", "Electricity and water", "Office"], ["5110", "Rent", "Office"], ["5120", "Repairs and maintenance", "Office"], ["5130", "Stationery and printing", "Office"],
  ["5140", "Phone and internet", "Office"], ["5150", "Software and subscriptions", "Office"], ["5160", "Professional fees", "Office"], ["5170", "Housekeeping and security", "Office"],
  ["5200", "Fuel", "Transport"], ["5210", "Vehicle repairs and insurance", "Transport"], ["5300", "Events and activities", "Academic"], ["5310", "Books and lab material", "Academic"],
] as const;

/** Make sure the chart exists (first use of a school) and return system key -> account id. Safe to call in every posting. */
export async function systemAccounts(tx: Tx, schoolId: string): Promise<Record<SystemAccount, string>> {
  const load = () => tx.select({ id: finAccounts.id, key: finAccounts.systemKey }).from(finAccounts).where(and(eq(finAccounts.schoolId, schoolId), isNotNull(finAccounts.systemKey)));
  let rows = await load();
  if (rows.length < SYSTEM_ACCOUNTS.length) {
    await tx.insert(finAccounts).values(SYSTEM_ACCOUNTS.map(({ key, ...a }) => ({ schoolId, ...a, systemKey: key }))).onConflictDoNothing();
    if (!rows.length) await tx.insert(finAccounts).values(STARTER.map(([code, name, group]) => ({ schoolId, code, name, type: "expense" as const, group }))).onConflictDoNothing();
    rows = await load();
  }
  return Object.fromEntries(rows.map((r) => [r.key!, r.id])) as Record<SystemAccount, string>;
}
