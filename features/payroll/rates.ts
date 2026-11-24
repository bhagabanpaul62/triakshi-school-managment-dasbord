// Statutory rates as dated data. Every row says where it came from and how sure we are. A school may override any of
// them (pay_rate_overrides). A month with no row means the amount is typed by a person: nothing is ever guessed.
// Checked 2026-11-24 against secondary sources and the PIB/ESIC pages named below. Not legal advice.
import type { CONFIDENCE } from "./constants";

export interface Slab { /** Applies to monthly gross above this, paise. */ over: number; paise: number; /** A different amount in one month (1-12), e.g. February. */ special?: { month: number; paise: number } }
export interface Rate<T = unknown> { key: string; state?: string; from: string; to?: string; value: T; source: string; confidence: (typeof CONFIDENCE)[number]; note?: string }

const RS = 100;
const PIB = "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2313790";
const KREDILY = "https://kredily.com/pf-wage-ceiling-25000/";
const PT = "https://hrone.cloud/blog/professional-tax-slab-rates-2026-27/";
const TAX = "https://www.bankbazaar.com/tax/income-tax-slabs.html";
const pt = (state: string, confidence: Rate["confidence"], slabs: [number, number, Slab["special"]?][], over: Partial<Rate> = {}): Rate<Slab[]> => ({
  key: "pt", state, from: "2026-04-01", value: slabs.map(([o, p, special]) => ({ over: o * RS, paise: p * RS, ...(special ? { special } : {}) })), source: PT, confidence, ...over,
} as Rate<Slab[]>);
const feb = (rs: number) => ({ month: 2, paise: rs * RS });

export const RATES: Rate[] = [
  // Provident fund. September 2026 spans both ceilings.
  { key: "pf_ceiling", from: "2014-09-01", to: "2026-09-16", value: 15_000 * RS, source: PIB, confidence: "high" },
  { key: "pf_ceiling", from: "2026-09-17", value: 25_000 * RS, source: PIB, confidence: "high", note: "PIB, 23 Sep 2026: effective 17 September 2026." },
  { key: "pf_employee_bp", from: "2014-09-01", value: 1200, source: KREDILY, confidence: "medium" },
  { key: "pf_employer_bp", from: "2014-09-01", value: 1200, source: KREDILY, confidence: "medium", note: "Includes the pension share." },
  { key: "eps_bp", from: "2014-09-01", value: 833, source: KREDILY, confidence: "medium", note: "Out of the employer's 12%, up to the ceiling." },
  { key: "edli_bp", from: "2014-09-01", value: 50, source: KREDILY, confidence: "medium" },
  { key: "pf_admin_bp", from: "2018-06-01", value: 50, source: KREDILY, confidence: "medium" },
  { key: "pf_admin_min", from: "2018-06-01", value: 500 * RS, source: KREDILY, confidence: "low", note: "Per establishment a month; sources disagree." },
  // ESI
  { key: "esi_ceiling", from: "2017-01-01", value: 21_000 * RS, source: "https://esic.gov.in/coverage", confidence: "high" },
  { key: "esi_employee_bp", from: "2019-07-01", value: 75, source: "https://esic.gov.in/coverage", confidence: "medium" },
  { key: "esi_employer_bp", from: "2019-07-01", value: 325, source: "https://esic.gov.in/coverage", confidence: "medium" },
  // Wages: allowances above this share of pay are added back for PF and gratuity.
  { key: "wage_exclusion_bp", from: "2025-11-21", value: 5000, source: "https://taxguru.in/corporate-law/labour-code.html", confidence: "medium" },
  // Exit
  { key: "exit_pay_days", from: "2025-11-21", value: 2, source: "https://www.livelaw.in/articles/two-working-days-code-wages-employee-final-settlement-552780", confidence: "medium", note: "Working days, for wages." },
  { key: "gratuity_days", from: "2025-11-21", value: 30, source: "https://www.livelaw.in/articles/two-working-days-code-wages-employee-final-settlement-552780", confidence: "medium" },
  { key: "gratuity_years", from: "2025-11-21", value: 5, source: "https://taxguru.in/corporate-law/labour-code.html", confidence: "medium", note: "Permanent staff. Contract staff: gratuity_years_fixed." },
  { key: "gratuity_years_fixed", from: "2025-11-21", value: 1, source: "https://taxguru.in/corporate-law/labour-code.html", confidence: "medium" },
  { key: "gratuity_max", from: "2018-03-29", value: 20_00_000 * RS, source: "https://taxguru.in/corporate-law/labour-code.html", confidence: "low" },
  // Professional tax, monthly gross
  pt("Karnataka", "medium", [[24_999.99, 200, feb(300)]]),
  pt("Maharashtra", "medium", [[7_500, 175], [10_000, 200, feb(300)]], { note: "Men. Women are exempt up to a higher limit that sources disagree on." }),
  pt("Telangana", "medium", [[15_000, 150], [20_000, 200]]),
  pt("Andhra Pradesh", "medium", [[15_000, 150], [20_000, 200]]),
  pt("Gujarat", "medium", [[12_000, 200]]),
  pt("West Bengal", "low", [[10_000, 110], [15_000, 130], [25_000, 150], [40_000, 200]], { to: "2026-09-30" }),
  pt("West Bengal", "low", [[20_000, 100], [30_000, 140], [50_000, 170], [100_000, 208]], { from: "2026-10-01", note: "One source reports this revision." }),
  pt("Madhya Pradesh", "low", [[18_750, 125], [25_000, 208]]),
  pt("Odisha", "low", [], { note: "Reported abolished from 1 April 2026." }),
  // Income tax, tax year 2026-27: [upper limit paise, basis points]; null = no limit.
  { key: "tax_slabs_new", from: "2026-04-01", to: "2027-03-31", value: [[4_00_000, 0], [8_00_000, 500], [12_00_000, 1000], [16_00_000, 1500], [20_00_000, 2000], [24_00_000, 2500], [null, 3000]].map(([l, b]) => [l === null ? null : (l as number) * RS, b]), source: TAX, confidence: "medium" },
  { key: "tax_slabs_old", from: "2026-04-01", to: "2027-03-31", value: [[2_50_000, 0], [5_00_000, 500], [10_00_000, 2000], [null, 3000]].map(([l, b]) => [l === null ? null : (l as number) * RS, b]), source: TAX, confidence: "low", note: "Under 60." },
  { key: "tax_std_new", from: "2026-04-01", to: "2027-03-31", value: 75_000 * RS, source: TAX, confidence: "medium" },
  { key: "tax_std_old", from: "2026-04-01", to: "2027-03-31", value: 50_000 * RS, source: TAX, confidence: "medium" },
  { key: "tax_rebate_new", from: "2026-04-01", to: "2027-03-31", value: { upTo: 12_00_000 * RS, max: 60_000 * RS, marginal: true }, source: TAX, confidence: "medium" },
  { key: "tax_rebate_old", from: "2026-04-01", to: "2027-03-31", value: { upTo: 5_00_000 * RS, max: 12_500 * RS, marginal: false }, source: TAX, confidence: "medium" },
  { key: "tax_cess_bp", from: "2026-04-01", to: "2027-03-31", value: 400, source: TAX, confidence: "medium" },
];

/** The built-in row for a key on a day, preferring the state's own. */
export function builtIn<T>(key: string, day: string, state?: string | null): Rate<T> | null {
  const hit = RATES.filter((r) => r.key === key && r.from <= day && (!r.to || r.to >= day) && (r.state ? r.state.toLowerCase() === state?.trim().toLowerCase() : true))
    .sort((a, b) => Number(!!b.state) - Number(!!a.state) || b.from.localeCompare(a.from))[0];
  return (hit as Rate<T> | undefined) ?? null;
}
