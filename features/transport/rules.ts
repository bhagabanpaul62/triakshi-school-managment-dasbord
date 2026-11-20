// Pure transport rules: no database, no framework. Unit-tested in rules.test.ts.

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "07:10" -> minutes after midnight. */
export const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Seats taken as a 0-100 share of capacity (no vehicle or zero seats -> 0). */
export function occupancyPct(riders: number, capacity: number | null | undefined): number {
  if (!capacity || capacity <= 0) return 0;
  return Math.min(100, Math.round((riders / capacity) * 100));
}

/** Tone for the occupancy bar: full is a warning, nearly full is info. */
export const occupancyTone = (pct: number) => (pct >= 100 ? "danger" : pct >= 85 ? "warning" : "info") as "danger" | "warning" | "info";

export interface StopTimes { name: string; morningTime: string; eveningTime: string }

/**
 * Stops come in route order; both the morning and the evening times must strictly increase along it
 * (the vehicle never goes back in time). Returns the first problem (field + message), or null.
 */
export function stopTimeProblem(stops: StopTimes[]): { field: "morningTime" | "eveningTime"; message: string } | null {
  for (const field of ["morningTime", "eveningTime"] as const) {
    for (let i = 1; i < stops.length; i++) {
      if (minutes(stops[i]![field]) <= minutes(stops[i - 1]![field])) {
        const when = field === "morningTime" ? "morning" : "evening";
        return { field, message: `${stops[i]!.name} must come after ${stops[i - 1]!.name} in the ${when}.` };
      }
    }
  }
  return null;
}

/** Monthly fee for a rider: the stop's fee for both ways, half for one way. Paise. */
export function monthlyFeeFor(stopFeePaise: number, pickup: boolean, drop: boolean): number {
  if (pickup && drop) return stopFeePaise;
  if (pickup || drop) return Math.round(stopFeePaise / 2);
  return 0;
}

/** "14:30" -> "2:30 pm". */
export function clock12(t: string): string {
  const h = Number(t.slice(0, 2));
  return `${h % 12 || 12}:${t.slice(3, 5)} ${h < 12 ? "am" : "pm"}`;
}

// ----- transport fee months (A10: from the next full month, no pro-rata) -----

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-07-15" -> "2026-08-01"; December rolls into January of the next year. */
export function nextMonthStart(date: string): string {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
}

/** The first day of every month from `from` (a first of a month) up to and including `until`'s month. */
export function monthStarts(from: string, until: string): string[] {
  const out: string[] = [];
  for (let d = from; d.slice(0, 7) <= until.slice(0, 7); d = nextMonthStart(d)) out.push(d);
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-07-01" -> "Jul 2026". */
export const monthLabel = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

// ----- documents, checklist, tracking link -----

export const DOCUMENT_LABEL = { fitness: "Fitness certificate", insurance: "Insurance", permit: "Permit", puc: "Pollution (PUC)", other: "Other" } as const;

/** Days from `today` to `expiresOn` (negative = already expired). */
export const daysToExpiry = (expiresOn: string, today: string) =>
  Math.round((Date.UTC(+expiresOn.slice(0, 4), +expiresOn.slice(5, 7) - 1, +expiresOn.slice(8, 10)) - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))) / 86_400_000);

/** Alerts go out this many days before a paper expires, and on the day. */
export const ALERT_DAYS = [30, 7, 0] as const;

export type ExpiryState = "expired" | "soon" | "valid";
/** Expired = past its date; soon = inside the first alert window. */
export function expiryState(expiresOn: string, today: string): ExpiryState {
  const d = daysToExpiry(expiresOn, today);
  return d < 0 ? "expired" : d <= ALERT_DAYS[0] ? "soon" : "valid";
}

/** The alert thresholds a document has reached today: 30 from day 30, 7 from day 7, 0 from the day it expires (up to a week after, so a missed run still catches up). The job claims each once. */
export const dueAlertDays = (expiresOn: string, today: string): number[] => {
  const d = daysToExpiry(expiresOn, today);
  return d < -7 ? [] : ALERT_DAYS.filter((t) => d <= t);
};

export const DEFAULT_CHECKLIST = ["GPS", "CCTV", "Speed governor", "Lady attendant", "First aid kit", "Fire extinguisher", "School bus marking"] as const;

/** The checklist to show: the saved one, or the defaults all unticked. */
export const checklistOrDefault = (saved: { label: string; ok: boolean }[]) => (saved.length ? saved : DEFAULT_CHECKLIST.map((label) => ({ label, ok: false })));

/** "5 of 7" style completeness, as a 0-100 share. */
export const checklistPct = (items: { ok: boolean }[]) => (items.length ? Math.round((items.filter((i) => i.ok).length / items.length) * 100) : 0);

/** True only for a well-formed https URL: a tracking link opens in the student's browser, so no http, javascript: or data:. */
export function isHttpsUrl(s: string): boolean {
  try { return new URL(s).protocol === "https:"; } catch { return false; }
}
