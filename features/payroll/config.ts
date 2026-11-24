import { z } from "zod";
import type { Tx } from "@smw/db";
import { flag } from "@smw/feature-finance/services/common";
import { payConfig } from "./schema";

export const BANK_COLUMNS = ["name", "employeeId", "account", "ifsc", "bank", "amount", "narration", "payslipNo"] as const;
export const BANK_COLUMN_LABEL: Record<(typeof BANK_COLUMNS)[number], string> = { name: "Beneficiary name", employeeId: "Employee ID", account: "Account number", ifsc: "IFSC", bank: "Bank", amount: "Amount", narration: "Narration", payslipNo: "Payslip no" };

/** How the school runs payroll. The switches say which statutory lines the engine works out. */
export const payConfigInput = z.object({
  pf: flag, esi: flag, pt: flag, lwf: flag, tds: flag,
  /** State for professional tax when a person has none of their own. */
  state: z.string().trim().max(60).nullish().transform((v) => v || null),
  /** How an unpaid day is valued: of the calendar month, of a fixed 30, or of the working days. */
  lopBasis: z.enum(["calendar", "fixed30", "working"]).default("calendar"),
  /** Leave and notice are paid at gross divided by this. */
  dayDivisor: z.coerce.number().int().min(20).max(31).default(30),
  bankColumns: z.array(z.enum(BANK_COLUMNS)).min(1).default(["name", "account", "ifsc", "amount", "narration"]),
  establishment: z.string().trim().max(120).default(""),
});
export type PayConfig = z.infer<typeof payConfigInput>;

export async function loadPayConfig(tx: Tx): Promise<PayConfig & { saved: boolean }> {
  const [row] = await tx.select().from(payConfig).limit(1);
  // Until the school decides, professional tax and income tax are on and the rest are off.
  return { ...payConfigInput.parse({ pt: true, tds: true, ...(row?.config ?? {}) }), saved: !!row };
}
