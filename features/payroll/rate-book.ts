// Looks up every statutory rate: the school's own override first, then the built-in dated row. Reports where each came from.
import { z } from "zod";
import { monthEnd } from "@smw/feature-kit/money";
import type { Tx } from "@smw/db";
import type { CONFIDENCE } from "./constants";
import { daysIn, type PayRates, type RoundKey, type RoundMode, type TaxRates } from "./engine";
import { ROUNDING_RATES } from "./rounding";
import { RATES, builtIn, type Rate, type Slab } from "./rates";
import { payRateOverrides } from "./schema";

export type Confidence = (typeof CONFIDENCE)[number];
export interface RateUse { key: string; state: string | null; from: string; value: unknown; source: string; confidence: Confidence; overridden: boolean; note?: string }

const DUE_SOURCE = "https://www.epfindia.gov.in/";
/** Due days are not in the dated rate list; they are kept here with the same fields so a school can override them too. Not re-checked in this build. */
const EXTRA: Rate[] = [
  { key: "due_day_pf", from: "2014-09-01", value: 15, source: DUE_SOURCE, confidence: "medium", note: "15th of the next month." },
  { key: "due_day_esi", from: "2014-09-01", value: 15, source: "https://esic.gov.in/", confidence: "medium", note: "15th of the next month." },
  { key: "due_day_tds", from: "2014-09-01", value: 7, source: "https://incometaxindia.gov.in/", confidence: "medium", note: "7th of the next month." },
  { key: "due_day_pt", from: "2014-09-01", value: 20, source: "https://hrone.cloud/blog/professional-tax-slab-rates-2026-27/", confidence: "low", note: "Differs by state." },
  { key: "due_day_lwf", from: "2014-09-01", value: 15, source: "https://hrone.cloud/blog/professional-tax-slab-rates-2026-27/", confidence: "low", note: "Differs by state." },
];
/** Rates that are not in the dated list of rates.ts: due days and rounding rules. */
export const EXTRA_RATES: Rate[] = [...EXTRA, ...ROUNDING_RATES];
export const OVERRIDABLE_KEYS = [...new Set([...RATES, ...EXTRA_RATES].map((r) => r.key)), "lwf"];

const ROUND_DEFAULT: Record<RoundKey, RoundMode> = { esi_employee: "up", esi_employer: "up", pf_employee: "nearest", pf_employer: "nearest", eps: "nearest" };
const num = z.number().int().min(0);
const slabs = z.array(z.object({ over: num, paise: num, special: z.object({ month: z.number().int().min(1).max(12), paise: num }).optional() }));
const pairs = z.array(z.tuple([num.nullable(), num]));
const shape = (key: string): z.ZodType => {
  if (key.startsWith("round_")) return z.enum(["paise", "nearest", "up"]);
  if (key === "pt") return slabs;
  if (key === "lwf") return z.object({ employeePaise: num, employerPaise: num, months: z.array(z.number().int().min(1).max(12)).optional() });
  if (key.startsWith("tax_slabs")) return pairs;
  if (key.startsWith("tax_rebate")) return z.object({ upTo: num, max: num, marginal: z.boolean() });
  return num;
};
/** Check an override's value has the shape the engine reads; throws a ZodError. */
export const parseRateValue = (key: string, value: unknown) => shape(key).parse(value);

type Override = typeof payRateOverrides.$inferSelect;

export class RateBook {
  private constructor(private readonly overrides: Override[]) {}
  static async load(tx: Tx): Promise<RateBook> { return new RateBook(await tx.select().from(payRateOverrides)); }

  /** The rate in force on a day; a school's override beats the built-in row, and one for the state beats a general one. */
  resolve<T>(key: string, day: string, state?: string | null): RateUse & { value: T } | null {
    const st = state?.trim().toLowerCase() ?? null;
    const own = this.overrides.filter((o) => o.key === key && o.fromDate <= day && (!o.state || o.state.toLowerCase() === st))
      .sort((a, b) => Number(!!b.state) - Number(!!a.state) || b.fromDate.localeCompare(a.fromDate))[0];
    if (own) return { key, state: own.state, from: own.fromDate, value: own.value as T, source: `Set by your school: ${own.reason}`, confidence: "high", overridden: true };
    const row = builtIn<T>(key, day, state) ?? (EXTRA_RATES.find((r) => r.key === key && r.from <= day) as Rate<T> | undefined) ?? null;
    return row ? { key, state: row.state ?? null, from: row.from, value: row.value, source: row.source, confidence: row.confidence, overridden: false, note: row.note } : null;
  }

  /**
   * Everything the engine needs for one month, plus the list of rates it rests on (only those the school switched on, so a
   * low-confidence rule nobody uses does not worry anyone).
   */
  forMonth(month: string, o: { state: string | null; regime: "new" | "old"; config: PayRates["config"] }): { rates: PayRates; used: RateUse[] } {
    const used = new Map<string, RateUse>();
    const get = <T>(key: string, day = month, state?: string | null, track = true) => {
      const r = this.resolve<T>(key, day, state);
      if (r && track) used.set(`${r.key}|${r.state ?? ""}|${r.from}`, r);
      return r;
    };
    const num = (key: string, track: boolean) => get<number>(key, month, null, track)?.value ?? 0;
    const segments: PayRates["pfCeilingSegments"] = [];
    for (let d = 1; d <= daysIn(month); d++) {
      const day = `${month.slice(0, 8)}${String(d).padStart(2, "0")}`;
      const paise = get<number>("pf_ceiling", day, null, o.config.pf)?.value ?? 0;
      const last = segments.at(-1);
      if (last && last.paise === paise) last.days++; else segments.push({ days: 1, paise });
    }
    const tax = (() => {
      const day = month;
      const slabs = get<TaxRates["slabs"]>(`tax_slabs_${o.regime}`, day, null, o.config.tds);
      const std = get<number>(`tax_std_${o.regime}`, day, null, o.config.tds);
      const rebate = get<TaxRates["rebate"]>(`tax_rebate_${o.regime}`, day, null, o.config.tds);
      const cess = get<number>("tax_cess_bp", day, null, o.config.tds);
      return slabs && std && rebate && cess ? { slabs: slabs.value, std: std.value, rebate: rebate.value, cessBp: cess.value } : null;
    })();
    const lwf = get<{ employeePaise: number; employerPaise: number; months?: number[] }>("lwf", month, o.state, o.config.lwf)?.value ?? null;
    const pt = o.state ? get<Slab[]>("pt", month, o.state, o.config.pt)?.value ?? null : null;
    const rates: PayRates = {
      pfCeilingSegments: segments, pfEmployeeBp: num("pf_employee_bp", o.config.pf), pfEmployerBp: num("pf_employer_bp", o.config.pf), epsBp: num("eps_bp", o.config.pf),
      edliBp: num("edli_bp", o.config.pf), pfAdminBp: num("pf_admin_bp", o.config.pf), wageExclusionBp: num("wage_exclusion_bp", o.config.pf),
      esiCeiling: num("esi_ceiling", o.config.esi), esiEmployeeBp: num("esi_employee_bp", o.config.esi), esiEmployerBp: num("esi_employer_bp", o.config.esi),
      pt, lwf, tax, config: o.config,
      rounding: Object.fromEntries((Object.keys(ROUND_DEFAULT) as RoundKey[]).map((k) => [k, get<RoundMode>(`round_${k}`, month, null, k.startsWith("esi") ? o.config.esi : o.config.pf)?.value ?? ROUND_DEFAULT[k]])) as Record<RoundKey, RoundMode>,
    };
    return { rates, used: [...used.values()] };
  }

  /** The last day a payment for a month may be made: the due day of the following month. */
  dueDate(key: "pf" | "esi" | "pt" | "tds" | "lwf", month: string): string {
    const day = this.resolve<number>(`due_day_${key}`, month)?.value ?? 15;
    const next = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1)).toISOString().slice(0, 10);
    return `${next.slice(0, 8)}${String(Math.min(day, +monthEnd(next).slice(8))).padStart(2, "0")}`;
  }
}
