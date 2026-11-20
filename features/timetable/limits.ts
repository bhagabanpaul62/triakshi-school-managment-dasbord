import type { SlotOptions } from "./service";

/**
 * Would putting this teacher in this cell take them past their max per day or week? Returns the warning, or null.
 * A teacher already in the cell is already counted, so keeping them adds nothing.
 */
export function limitWarning(limits: SlotOptions["limits"], teacherId: string, day: number, alreadyHere: boolean): string | null {
  const l = limits[teacherId];
  if (!l || !teacherId) return null;
  const add = alreadyHere ? 0 : 1;
  const today = (l.day[day] ?? 0) + add, week = l.week + add;
  if (l.maxPerDay && today > l.maxPerDay) return `${today} periods that day, over their limit of ${l.maxPerDay}`;
  if (l.maxPerWeek && week > l.maxPerWeek) return `${week} periods that week, over their limit of ${l.maxPerWeek}`;
  return null;
}
