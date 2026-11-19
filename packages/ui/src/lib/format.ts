// Human formats used across every app. Dates show as "Sep 29", never ISO.
const IST = "Asia/Kolkata";

type DateLike = Date | string | number | null | undefined;
const toDate = (d: DateLike) => (d == null || d === "" ? null : d instanceof Date ? d : new Date(d));

/** "Sep 29" (adds the year when it is not this year: "Sep 29, 2025"). */
export function shortDate(d: DateLike, tz = IST): string {
  const x = toDate(d);
  if (!x || Number.isNaN(x.getTime())) return "-";
  const sameYear = x.getFullYear() === new Date().getFullYear();
  return x.toLocaleDateString("en-IN", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: tz });
}

/** "Sep 29, 10:30 am" */
export function dateTime(d: DateLike, tz = IST): string {
  const x = toDate(d);
  if (!x || Number.isNaN(x.getTime())) return "-";
  return `${shortDate(x, tz)}, ${x.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: tz })}`;
}

/** "2h ago", "3d ago", falling back to shortDate after a week. */
export function relative(d: DateLike): string {
  const x = toDate(d);
  if (!x) return "-";
  const s = (Date.now() - x.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return shortDate(x);
}

/** Paise (integer) to rupees display: 12345600 -> "₹1,23,456". */
export function paise(p: number | bigint | null | undefined): string {
  if (p == null) return "-";
  const r = Number(p) / 100;
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: Number.isInteger(r) ? 0 : 2 }).format(r);
}

export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
