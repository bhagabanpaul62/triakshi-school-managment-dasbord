// INR formatting for the whole product. Amounts arrive in rupees (callers divide paise by 100).

/** Compact Indian money for tiles and chart axes: "₹1.2Cr", "₹4.5L", "₹45.2K", "-₹800". */
export function formatMoneyCompact(value: number, _currency = "INR"): string {
  const safe = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(safe);
  const sign = safe < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`;
  return `${sign}₹${Math.round(abs).toLocaleString("en-IN")}`;
}

/** Full Indian money: "₹1,23,456" (paise shown only when present). */
export function formatMoney(value: number, _currency = "INR"): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: Number.isInteger(safe) ? 0 : 2 }).format(safe);
}

export const currencySymbol = (_c = "INR") => "₹";
