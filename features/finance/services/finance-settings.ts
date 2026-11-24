import { z } from "zod";
import { sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError } from "@smw/feature-kit";
import { fyOf, fyRange, todayIST } from "@smw/feature-kit/money";
import { finJournals, finSettings } from "../schema";
import { financeConfig, loadFinanceSettings, type FinanceConfig } from "../settings";
import { FinanceService, flag } from "./common";

/** The whole form is sent each time, so an unticked box (absent) means off. */
const updateInput = financeConfig.extend({
  basis: z.enum(["accrual", "cash"]),
  lateFeeFirst: flag, autoUseAdvance: flag, remindersOn: flag, upiOn: flag, holdReportCards: flag,
  reminderDays: z.preprocess((v) => (typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v), financeConfig.shape.reminderDays),
});

export type FinanceSettingsView = FinanceConfig & { basis: "accrual" | "cash"; basisLocked: boolean };

export class SettingsService extends FinanceService {
  async get(): Promise<FinanceSettingsView> {
    return this.read("read", async (tx) => ({ ...(await loadFinanceSettings(tx)), basisLocked: await this.hasEntriesThisYear(tx) }));
  }

  /** Replace the rules. The accounting basis can change only while this financial year has no entries. */
  async update(input: unknown): Promise<FinanceSettingsView> {
    this.authorize("settings", "write");
    const { basis, ...config } = this.parse(updateInput, input);
    return this.write("settings", async (tx) => {
      const before = await loadFinanceSettings(tx);
      const locked = await this.hasEntriesThisYear(tx);
      if (basis !== before.basis && locked) throw new ConflictError("This financial year already has entries, so the basis cannot change until next year.");
      await tx.insert(finSettings).values({ schoolId: this.ctx.schoolId, basis, config }).onConflictDoUpdate({ target: finSettings.schoolId, set: { basis, config } });
      return { ...config, basis, basisLocked: locked };
    }, (r) => ({ action: "update", entity: "Finance settings", summary: "Changed the finance rules", meta: { basis: r.basis } }));
  }

  private async hasEntriesThisYear(tx: Tx) {
    const [from, to] = fyRange(fyOf(todayIST()));
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(finJournals).where(sql`${finJournals.date} between ${from} and ${to}`);
    return Number(r?.n ?? 0) > 0;
  }
}
