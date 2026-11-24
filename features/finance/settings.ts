import { z } from "zod";
import type { Tx } from "@smw/db";
import { finSettings } from "./schema";

/** Every school-level money rule in one place. Limits are paise; 0 means "always needs approval". */
export const financeConfig = z.object({
  /** Concessions, waivers and write-offs up to this need no second person. */
  concessionLimitPaise: z.coerce.number().int().min(0).default(0),
  billLimitPaise: z.coerce.number().int().min(0).default(0),
  /** How many days back money may be dated. */
  backdateDays: z.coerce.number().int().min(0).max(365).default(7),
  lateFeeFirst: z.boolean().default(true),
  /** Extra money is used on the next invoice by itself. */
  autoUseAdvance: z.boolean().default(true),
  remindersOn: z.boolean().default(false),
  /** Days relative to the due date; negative = before. */
  reminderDays: z.array(z.coerce.number().int().min(-60).max(365)).max(10).default([-7, 0, 3, 10, 30]),
  /** Warn when one person pays this much cash in a day. */
  cashLimitPaise: z.coerce.number().int().min(0).default(20_000_000),
  /** A counter that is short or over by more than this closes without a second person. 0 = every difference needs approval. */
  counterDifferenceLimitPaise: z.coerce.number().int().min(0).default(0),
  bounceChargePaise: z.coerce.number().int().min(0).default(0),
  /** The families' pay page shows the UPI QR and takes UTR slips. */
  upiOn: z.boolean().default(false),
  holdReportCards: z.boolean().default(false),
});
export type FinanceConfig = z.infer<typeof financeConfig>;

export async function loadFinanceSettings(tx: Tx): Promise<FinanceConfig & { basis: "accrual" | "cash" }> {
  const [row] = await tx.select().from(finSettings).limit(1);
  return { basis: row?.basis ?? "accrual", ...financeConfig.parse(row?.config ?? {}) };
}
