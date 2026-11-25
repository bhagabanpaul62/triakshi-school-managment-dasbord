// Repeating events: pure date arithmetic in IST. The service turns each date into a real row.
import { MAX_REPEAT, type RepeatSpec } from "./constants";
import { addDays, addMonthsClamped, allDaySpan, daysBetween, istDay, parseIst, toInputValue } from "./dates";

export interface Slot { startsAt: Date; endsAt: Date | null }

/** The days a rule produces, starting with `first`. One more than the cap is returned so the caller can say "too many". */
export function repeatDays(first: string, rule: Pick<RepeatSpec, "kind" | "until">): string[] {
  const out: string[] = [];
  for (let k = 0; out.length <= MAX_REPEAT; k++) {
    const day = rule.kind === "monthly" ? addMonthsClamped(first, k) : addDays(first, k * (rule.kind === "weekly" ? 7 : 14));
    if (day > rule.until) break;
    out.push(day);
  }
  return out;
}

/** The same time of day (and length) on another day. */
export function onDay(base: Slot & { allDay: boolean }, day: string): Slot {
  if (base.allDay) {
    const span = base.endsAt ? daysBetween(istDay(base.startsAt), istDay(base.endsAt)) : 0;
    const r = allDaySpan(parseIst(day)!, parseIst(addDays(day, span)));
    return { startsAt: r.startsAt, endsAt: base.endsAt ? r.endsAt : null };
  }
  const start = parseIst(`${day}T${toInputValue(base.startsAt).slice(11)}`)!;
  return { startsAt: start, endsAt: base.endsAt ? new Date(start.getTime() + (base.endsAt.getTime() - base.startsAt.getTime())) : null };
}
