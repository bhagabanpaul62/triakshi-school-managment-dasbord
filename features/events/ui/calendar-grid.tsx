import Link from "next/link";
import { IconChevronRight } from "@tabler/icons-react";
import { TONE } from "@smw/ui/tone";
import { cn } from "@smw/ui/utils";
import { AGENDA_DAYS, addDays, daysOf, shiftMonth, weekStart, type CalendarView } from "../dates";
import { LAYERS, LAYER_TONE, TYPE_TONE, type CalendarItem } from "../constants";
import { LINK, MUTED, PILL } from "./styles";
import { clock, plural } from "@smw/feature-kit/words";
import { FOCUS } from "@smw/ui/finance/ui";

export type UrlFor = (o: Record<string, string | undefined>) => string;
const label = (day: string, o: Intl.DateTimeFormatOptions) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { ...o, timeZone: "UTC" });
const toneOf = (i: CalendarItem) => TONE[i.type ? TYPE_TONE[i.type] : LAYER_TONE[i.layer]];

/** Items by IST day, all-day first, then by time. */
export function byDay(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const out = new Map<string, CalendarItem[]>();
  for (const i of items) for (const d of daysOf(i.startsAt, i.endsAt)) out.set(d, [...(out.get(d) ?? []), i]);
  for (const list of out.values()) list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.localeCompare(b.startsAt));
  return out;
}

/** One calendar item. Layers other than events are read only and open their own page. */
export function ItemRow({ item }: { item: CalendarItem }) {
  const tone = toneOf(item);
  const inner = (
    <>
      <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", tone.dot)} />
      <span className="w-16 shrink-0 text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{item.allDay ? "All day" : clock(item.startsAt)}</span>
      <span className="min-w-0 flex-1">
        <span className={cn("block text-sm text-[var(--ds-on-surface)]", item.cancelled && "line-through opacity-70")}>{item.title}</span>
        <span className="block text-xs text-[var(--ds-on-surface-muted)]">
          {item.layer !== "events" ? `${LAYERS[item.layer]}${item.meta ? ` · ${item.meta}` : ""}` : item.meta ?? ""}
          {item.cancelled ? " · Cancelled" : ""}
        </span>
      </span>
      {item.href ? <IconChevronRight aria-hidden className="mt-1 h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" /> : null}
    </>
  );
  const cls = cn("flex min-h-11 items-start gap-3 rounded-xl px-2 py-2", item.href && cn("hover:bg-white/[0.05]", FOCUS));
  return item.href ? <Link href={item.href} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

const dayHeading = (day: string, today: string) => {
  const prefix = day === today ? "Today, " : day === addDays(today, 1) ? "Tomorrow, " : "";
  return `${prefix}${label(day, { weekday: "short", day: "numeric", month: "short" })}`;
};

export function Agenda({ items, anchor, today, url, empty }: { items: CalendarItem[]; anchor: string; today: string; url: UrlFor; empty: React.ReactNode }) {
  const days = byDay(items);
  const keys = [...days.keys()].filter((d) => d >= anchor && d < addDays(anchor, AGENDA_DAYS)).sort();
  return (
    <div className="flex flex-col gap-4">
      <Link href={url({ view: "agenda", date: addDays(anchor, -AGENDA_DAYS) })} className={cn(LINK, "self-start text-sm text-[var(--ds-on-surface-muted)]")}>Earlier</Link>
      {keys.length === 0 ? empty : keys.map((d) => (
        <section key={d} aria-labelledby={`d-${d}`} className="rounded-3xl bg-[var(--ds-surface-container-low)] p-4">
          <h2 id={`d-${d}`} className={cn("px-2 pb-1 text-[13px] font-medium", d === today ? "text-[var(--ds-color-primary-300)]" : "text-[var(--ds-on-surface-variant)]")}>{dayHeading(d, today)}</h2>
          <ul>{days.get(d)!.map((i) => <li key={`${i.layer}-${i.id}`}><ItemRow item={i} /></li>)}</ul>
        </section>
      ))}
      <Link href={url({ view: "agenda", date: addDays(anchor, AGENDA_DAYS) })} className={cn(PILL, "self-start")}>Later</Link>
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function Month({ items, anchor, today, url }: { items: CalendarItem[]; anchor: string; today: string; url: UrlFor }) {
  const ym = anchor.slice(0, 7), days = byDay(items);
  const first = weekStart(`${ym}-01`), end = `${shiftMonth(ym, 1)}-01`;
  const cells: string[] = [];
  for (let d = first; d < end || cells.length % 7; d = addDays(d, 1)) cells.push(d);
  return (
    <div role="grid" aria-label={label(`${ym}-01`, { month: "long", year: "numeric" })} className="overflow-hidden rounded-3xl bg-[var(--ds-surface-container-low)] p-2 sm:p-4">
      <div role="row" className="grid grid-cols-7 pb-1">{WEEKDAYS.map((w) => <span key={w} role="columnheader" className="px-1 text-center text-[11px] uppercase text-[var(--ds-on-surface-muted)]">{w}</span>)}</div>
      <div className="grid grid-cols-7 gap-px">
        {cells.map((d) => {
          const list = days.get(d) ?? [], inMonth = d.startsWith(ym);
          return (
            <Link key={d} role="gridcell" href={url({ view: "week", date: d })} aria-label={`${label(d, { day: "numeric", month: "long" })}, ${plural(list.length, "item")}`}
              className={cn("flex min-h-14 min-w-0 flex-col gap-0.5 rounded-lg bg-white/[0.03] p-1 hover:bg-white/[0.07] sm:min-h-24 sm:p-1.5", FOCUS, !inMonth && "opacity-40")}>
              <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums", d === today && "bg-[var(--ds-primary)] font-medium text-[var(--ds-on-primary)]")}>{Number(d.slice(8))}</span>
              <span className="flex flex-wrap gap-0.5 sm:hidden" aria-hidden>{list.slice(0, 4).map((i) => <span key={`${i.layer}-${i.id}`} className={cn("h-1.5 w-1.5 rounded-full", toneOf(i).dot)} />)}</span>
              <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
                {list.slice(0, 3).map((i) => <span key={`${i.layer}-${i.id}`} className={cn("truncate rounded px-1 text-[11px] leading-5", toneOf(i).chip, i.cancelled && "line-through")}>{i.title}</span>)}
                {list.length > 3 ? <span className="px-1 text-[11px] text-[var(--ds-on-surface-muted)]">+{list.length - 3} more</span> : null}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function Week({ items, anchor, today }: { items: CalendarItem[]; anchor: string; today: string }) {
  const days = byDay(items), first = weekStart(anchor);
  return (
    <div className="grid gap-3 lg:grid-cols-7">
      {Array.from({ length: 7 }, (_, n) => addDays(first, n)).map((d) => (
        <section key={d} aria-labelledby={`w-${d}`} className="min-w-0 rounded-3xl bg-[var(--ds-surface-container-low)] p-3">
          <h2 id={`w-${d}`} className={cn("px-2 pb-1 text-[13px] font-medium", d === today ? "text-[var(--ds-color-primary-300)]" : "text-[var(--ds-on-surface-variant)]")}>{dayHeading(d, today)}</h2>
          {(days.get(d) ?? []).length ? <ul>{days.get(d)!.map((i) => <li key={`${i.layer}-${i.id}`}><ItemRow item={i} /></li>)}</ul> : <p className={cn(MUTED, "px-2 pb-2")}>Nothing on this day.</p>}
        </section>
      ))}
    </div>
  );
}

/** Twelve small months: a day with something on it is filled, and links to that day's week. */
export function Year({ items, anchor, today, url }: { items: CalendarItem[]; anchor: string; today: string; url: UrlFor }) {
  const year = anchor.slice(0, 4), days = byDay(items);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 12 }, (_, m) => `${year}-${String(m + 1).padStart(2, "0")}`).map((ym) => {
        const cells: string[] = [];
        for (let d = weekStart(`${ym}-01`); d < `${shiftMonth(ym, 1)}-01` || cells.length % 7; d = addDays(d, 1)) cells.push(d);
        return (
          <section key={ym} aria-labelledby={`y-${ym}`} className="rounded-3xl bg-[var(--ds-surface-container-low)] p-4">
            <h2 id={`y-${ym}`} className="pb-2 text-[13px] font-medium"><Link href={url({ view: "month", date: `${ym}-01` })} className={cn("rounded hover:underline", FOCUS)}>{label(`${ym}-01`, { month: "long" })}</Link></h2>
            <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]">
              {WEEKDAYS.map((w) => <span key={w} aria-hidden className="text-[var(--ds-on-surface-muted)]">{w[0]}</span>)}
              {cells.map((d) => {
                if (!d.startsWith(ym)) return <span key={d} />;
                const n = days.get(d)?.length ?? 0;
                return (
                  <Link key={d} href={url({ view: "week", date: d })} aria-label={`${label(d, { day: "numeric", month: "long" })}, ${plural(n, "item")}`}
                    className={cn("flex h-7 items-center justify-center rounded-md tabular-nums hover:bg-white/[0.12]", FOCUS, n ? "bg-white/[0.12] font-medium" : "text-[var(--ds-on-surface-variant)]", d === today && "ring-1 ring-[var(--ds-primary)]")}>{Number(d.slice(8))}</Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export const VIEWS: { key: CalendarView; label: string }[] = [{ key: "agenda", label: "Agenda" }, { key: "month", label: "Month" }, { key: "week", label: "Week" }, { key: "year", label: "Year" }];
