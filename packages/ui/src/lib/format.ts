// Human formats used across every app. Dates show as "Sep 29", never ISO.
import { formatMoneyCompact } from "./hooks/useCurrency";
const IST = "Asia/Kolkata";

type DateLike = Date | string | number | null | undefined;
const toDate = (d: DateLike) => (d == null || d === "" ? null : d instanceof Date ? d : new Date(d));

/** "29 Sep", the Indian order (adds the year when it is not this year: "29 Sep 2025"). */
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

/** Money for a tile, from paise: whole rupees below a lakh ("₹86,500"), compact above ("₹1.2L") so it fits a phone. */
export const tilePaise = (p: number) => (Math.abs(p) >= 10_000_000 ? formatMoneyCompact(p / 100) : paise(Math.round(p / 100) * 100));

/** "Nov" from "2026-11-01". */
export const monthName = (day: string) => new Date(`${day.slice(0, 10).padEnd(10, "-01")}T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
