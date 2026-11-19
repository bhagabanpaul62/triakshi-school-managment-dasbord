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
