// Money and dates every finance module shares. Pure: integer paise, "YYYY-MM-DD" dates, no clock and no time zones.

/** Split `total` over `weights` in proportion, in whole units, so the parts add up exactly (largest remainder). */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length) return [];
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const parts = weights.map((w) => Math.floor((total * w) / sum));
  const order = weights.map((w, i) => ({ i, rem: (total * w) % sum })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  const remainder = total - parts.reduce((a, b) => a + b, 0);
  for (let k = 0; k < remainder; k++) parts[order[k % order.length]!.i]!++;
  return parts;
}

/** Percent in basis points (1000 = 10%) of a base, rounded to whole paise. */
export const percentOf = (base: number, basisPoints: number) => Math.round((base * basisPoints) / 10_000);

/** "₹18,000" or "₹18,000.50" from paise. */
export const rupees = (p: number) => `${p < 0 ? "-" : ""}₹${(Math.abs(p) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: p % 100 ? 2 : 0 })}`;

/** Today in India. */
export const todayIST = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** Indian financial year of a date: "2026-04-01" -> "2026-27". */
export function fyOf(day: string): string {
  const y = +day.slice(5, 7) >= 4 ? +day.slice(0, 4) : +day.slice(0, 4) - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
}
/** First and last day of a financial year label: "2026-27" -> ["2026-04-01", "2027-03-31"]. */
export const fyRange = (fy: string): [string, string] => [`${fy.slice(0, 4)}-04-01`, `${+fy.slice(0, 4) + 1}-03-31`];

const DAY = 86_400_000;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
/** First day of the month `n` months after `day`'s month. */
export const addMonths = (day: string, n: number) => new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 10);
export const monthEnd = (day: string) => addDays(addMonths(day, 1), -1);

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function words(n: number): string {
  if (n < 20) return ONES[n]!;
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
  for (const [size, name] of [[10_000_000, "Crore"], [100_000, "Lakh"], [1000, "Thousand"], [100, "Hundred"]] as const) {
    if (n >= size) return `${words(Math.floor(n / size))} ${name}${n % size ? ` ${words(n % size)}` : ""}`;
  }
  return "";
}
/** "Rupees One Lakh Twenty Three Thousand and Fifty Paise Only" from paise. */
export function inWords(paise: number): string {
  const r = Math.floor(Math.abs(paise) / 100), p = Math.abs(paise) % 100;
  return `Rupees ${r ? words(r) : "Zero"}${p ? ` and ${words(p)} Paise` : ""} Only`;
}
