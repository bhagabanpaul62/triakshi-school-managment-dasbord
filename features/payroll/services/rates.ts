import { eq } from "drizzle-orm";
import { z } from "zod";
import { NotFoundError, ValidationError, rethrowUnique } from "@smw/feature-kit";
import { todayIST } from "@smw/feature-kit/money";
import { day } from "@smw/feature-finance/services/common";
import { PayrollService } from "../base";
import { EXTRA_RATES, OVERRIDABLE_KEYS, parseRateValue, type RateUse } from "../rate-book";
import { RATES } from "../rates";
import { payRateOverrides } from "../schema";

export interface RateRow extends RateUse { id: string | null; shown: unknown; label: string }
const overrideInput = z.object({ key: z.string().refine((k) => OVERRIDABLE_KEYS.includes(k), "Unknown rate."), state: z.string().trim().max(60).optional().transform((v) => v || null), fromDate: day, value: z.unknown(), reason: z.string().trim().min(3, "Say where this number comes from.").max(200) });

const LABEL: Record<string, string> = {
  pf_ceiling: "PF wage ceiling", pf_employee_bp: "PF, employee share", pf_employer_bp: "PF, employer share", eps_bp: "Pension share (EPS)", edli_bp: "EDLI", pf_admin_bp: "PF admin charges", pf_admin_min: "PF admin minimum",
  esi_ceiling: "ESI wage ceiling", esi_employee_bp: "ESI, employee share", esi_employer_bp: "ESI, employer share", wage_exclusion_bp: "Allowances kept out of PF wages", exit_pay_days: "Days to pay wages after exit", gratuity_days: "Days to pay gratuity",
  gratuity_years: "Gratuity: years for permanent staff", gratuity_years_fixed: "Gratuity: years for contract staff", gratuity_max: "Gratuity cap", pt: "Professional tax", lwf: "Labour welfare fund",
  tax_slabs_new: "Tax slabs, new regime", tax_slabs_old: "Tax slabs, old regime", tax_std_new: "Standard deduction, new regime", tax_std_old: "Standard deduction, old regime", tax_rebate_new: "Rebate, new regime", tax_rebate_old: "Rebate, old regime", tax_cess_bp: "Cess",
  round_pf_employee: "Rounding: employee PF", round_pf_employer: "Rounding: employer PF", round_eps: "Rounding: pension share", round_esi_employee: "Rounding: employee ESI", round_esi_employer: "Rounding: employer ESI",
  due_day_pf: "PF due day", due_day_esi: "ESI due day", due_day_tds: "Tax due day", due_day_pt: "Professional tax due day", due_day_lwf: "Labour welfare due day",
};
export const rateLabel = (key: string) => LABEL[key] ?? key;

export class RateService extends PayrollService {
  /** Every rate in force today: the value, since when, where it came from, how sure we are, and whether the school changed it. */
  async list(): Promise<RateRow[]> {
    return this.read("read", async (tx) => {
      const book = await this.rateBook(tx), today = todayIST();
      const keys = [...new Map([...RATES, ...EXTRA_RATES].filter((r) => r.from <= today && (!r.to || r.to >= today)).map((r) => [`${r.key}|${r.state ?? ""}`, r])).values()];
      const out: RateRow[] = [];
      for (const r of keys) { const u = book.resolve(r.key, today, r.state); if (u) out.push({ ...u, id: null, shown: u.value, label: rateLabel(r.key) }); }
      const own = await tx.select().from(payRateOverrides);
      const rows = out.map((r) => ({ ...r, id: r.overridden ? own.find((o) => o.key === r.key && o.fromDate === r.from && (o.state ?? null) === r.state)?.id ?? null : null }));
      for (const o of own.filter((o) => !rows.some((r) => r.id === o.id) && o.fromDate <= today)) rows.push({ id: o.id, key: o.key, state: o.state, from: o.fromDate, value: o.value, shown: o.value, source: `Set by your school: ${o.reason}`, confidence: "high", overridden: true, label: rateLabel(o.key) });
      return rows.sort((a, b) => a.label.localeCompare(b.label) || (a.state ?? "").localeCompare(b.state ?? ""));
    });
  }

  async override(input: unknown): Promise<void> {
    this.authorize("manage", "write");
    const d = this.parse(overrideInput, input);
    let value: unknown;
    try { value = parseRateValue(d.key, d.value); } catch { throw new ValidationError({ value: "This value does not have the shape this rate needs." }); }
    try {
      await this.write("manage", async (tx) => { await tx.insert(payRateOverrides).values({ schoolId: this.ctx.schoolId, key: d.key, state: d.state, fromDate: d.fromDate, value, reason: d.reason, createdBy: this.ctx.userId }); },
        () => ({ action: "override_rate", entity: "PayRateOverride", summary: `Set ${d.key}${d.state ? ` for ${d.state}` : ""} from ${d.fromDate}`, meta: { key: d.key, reason: d.reason } }));
    } catch (e) { rethrowUnique(e, "You already set this rate from that date. Use a later date."); }
  }

  async removeOverride(id: string): Promise<void> {
    await this.write("manage", async (tx) => { if (!(await tx.delete(payRateOverrides).where(eq(payRateOverrides.id, id)).returning()).length) throw new NotFoundError("Override"); },
      () => ({ action: "remove_override", entity: "PayRateOverride", entityId: id, summary: "Went back to the built-in rate" }));
  }
}
