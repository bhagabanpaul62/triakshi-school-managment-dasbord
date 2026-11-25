// Plain India-time words for "when": always with the day, never a bare clock time. Pure, so services and screens share it.
import { clock, istDay } from "@smw/feature-kit/words";

const DAY = 86_400_000;
const midnight = (d: Date | string | number) => Date.parse(`${istDay(d)}T00:00:00Z`);

/** "today", "tomorrow", "yesterday", or "Mon 30 Nov". */
export function dayWord(at: Date | string | number, now: Date | string | number = new Date()): string {
  const n = Math.round((midnight(at) - midnight(now)) / DAY);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return new Date(at).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).replace(",", "");
}

/** "tomorrow 7:00 am". */
export const dayTime = (at: Date | string | number, now?: Date | string | number) => `${dayWord(at, now)} ${clock(at)}`;

/** "7:00 am" in words a person can plan with: "tomorrow at 7:00 am". */
export const dayAt = (at: Date | string | number, now?: Date | string | number) => `${dayWord(at, now)} at ${clock(at)}`;

/** The state line under my newest message. Waiting while it is held for quiet hours, then Delivered, then Seen. */
export function stateLine(m: { deliverAfter: string | null; seen: { by: number; of: number; at: string | null } | null }, now?: Date): string {
  if (m.deliverAfter) return `Waiting until ${dayTime(m.deliverAfter, now)}`;
  if (!m.seen || !m.seen.by) return "Delivered";
  const when = m.seen.at ? ` ${dayTime(m.seen.at, now)}` : "";
  return m.seen.of === 1 ? `Seen${when}` : `Seen by ${m.seen.by} of ${m.seen.of}${when}`;
}
