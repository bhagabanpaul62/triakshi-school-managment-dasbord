import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { IconPlus } from "@tabler/icons-react";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { cn } from "@smw/ui/utils";
import { EmptyLine } from "@smw/ui/finance/States";
import { AGENDA_DAYS, addDays, shiftMonth, viewRange, weekStart, type CalendarView } from "../dates";
import { LAYERS, type CalendarItem, type LayerKey } from "../constants";
import { Agenda, Month, VIEWS, Week, Year, type UrlFor } from "./calendar-grid";
import { EventService } from "../service";
import { PhoneCalendar } from "./phone-calendar";
import { PILL, PRIMARY } from "./styles";

export interface CalendarPageProps {
  items: CalendarItem[]; view: CalendarView; anchor: string; today: string;
  /** Layers this person may see, and the ones switched on. */
  layers: LayerKey[]; chosen: LayerKey[]; /** What shows when nobody picked: the address stays short while it holds. */ defaults: LayerKey[];
  canAdd: boolean; holidays: "add" | "view" | null;
  phone: { active: boolean; lastUsed: string | null };
}

const long = (day: string, o: Intl.DateTimeFormatOptions) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { ...o, timeZone: "UTC" });
function title(view: CalendarView, anchor: string) {
  if (view === "month") return long(anchor, { month: "long", year: "numeric" });
  if (view === "year") return anchor.slice(0, 4);
  if (view === "week") return `${long(weekStart(anchor), { day: "numeric", month: "short" })} to ${long(addDays(weekStart(anchor), 6), { day: "numeric", month: "short", year: "numeric" })}`;
  return `From ${long(anchor, { day: "numeric", month: "short", year: "numeric" })}`;
}
const step = (view: CalendarView, anchor: string, n: 1 | -1) =>
  view === "month" ? `${shiftMonth(anchor.slice(0, 7), n)}-01` : view === "year" ? `${Number(anchor.slice(0, 4)) + n}-01-01` : view === "week" ? addDays(weekStart(anchor), 7 * n) : addDays(anchor, AGENDA_DAYS * n);

/** The calendar: agenda (the default, from today), month, week and year planner. The view, the day and the layers live in the address. */
export async function CalendarPage({ items, view, anchor, today, layers, chosen, defaults, canAdd, holidays, phone }: CalendarPageProps) {
  // Looking at the holidays layer is reading the holiday notices for those days.
  if (chosen.includes("holidays")) { const { from, to } = viewRange(view, anchor); await new EventService(await requireCtx()).seeHolidays(from, to); }
  const isDefault = (l: LayerKey[]) => l.length === defaults.length && defaults.every((x) => l.includes(x));
  const url: UrlFor = (o) => {
    const p = new URLSearchParams();
    const v = o.view ?? view, d = o.date ?? anchor;
    if (v !== "agenda") p.set("view", v);
    if (d !== today) p.set("date", d);
    if (!isDefault(chosen)) p.set("layers", chosen.join(",") || "none");
    const q = p.toString();
    return q ? `/app/events?${q}` : "/app/events";
  };
  const toggle = (l: LayerKey) => {
    const next = chosen.includes(l) ? chosen.filter((x) => x !== l) : layers.filter((x) => chosen.includes(x) || x === l);
    const p = new URLSearchParams();
    if (view !== "agenda") p.set("view", view);
    if (anchor !== today) p.set("date", anchor);
    if (!isDefault(next)) p.set("layers", next.join(",") || "none");
    return p.toString() ? `/app/events?${p}` : "/app/events";
  };
  const add = canAdd ? <Link href="/app/events/new" className={PRIMARY}><IconPlus className="h-4 w-4" aria-hidden />Add event</Link> : null;
  const empty = (
    <EmptyLine title={chosen.length < layers.length && !chosen.length ? "All layers are switched off." : "Nothing on the calendar here."}
      hint={chosen.length < layers.length ? "Switch a layer on above, or look at another time." : canAdd ? "Add an event so families, students and staff can plan around it." : "Events, exams and holidays show here when they are added."} action={add} />
  );

  return (
    <>
      <PageHeader eyebrow="Communication" title="Calendar" description="Events, exams, holidays and homework in one place."
        actions={<>
          <PhoneCalendar active={phone.active} lastUsed={phone.lastUsed} publicFeed={false} />
          {holidays ? <Link href="/app/attendance/holidays" className={PILL}>{holidays === "add" ? "Add holiday" : "Holidays"}</Link> : null}
          {add}
        </>} />
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Link href={url({ date: step(view, anchor, -1) })} aria-label="Earlier" className={PILL}>Back</Link>
            <Link href={url({ date: today })} className={PILL}>Today</Link>
            <Link href={url({ date: step(view, anchor, 1) })} aria-label="Later" className={PILL}>Next</Link>
            <h2 className="min-w-0 truncate px-1 text-sm font-medium text-[var(--ds-on-surface)] sm:px-2 sm:text-lg" aria-live="polite">{title(view, anchor)}</h2>
          </div>
          <nav aria-label="Calendar view" className="flex w-full gap-1 rounded-full bg-white/[0.05] p-1 sm:ml-auto sm:w-auto">
            {VIEWS.map((v) => (
              <Link key={v.key} href={url({ view: v.key, date: v.key === "agenda" ? today : anchor })} aria-current={v.key === view ? "page" : undefined}
                className={cn("inline-flex min-h-9 flex-1 items-center justify-center rounded-full px-4 text-sm sm:flex-none", v.key === view ? "bg-[var(--ds-primary)] font-medium text-[var(--ds-on-primary)]" : "text-[var(--ds-on-surface-variant)] hover:bg-white/[0.08]")}>{v.label}</Link>
            ))}
          </nav>
        </div>
        {layers.length > 1 ? (
          <nav aria-label="Layers" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            {layers.map((l) => (
              <Link key={l} href={toggle(l)} aria-current={chosen.includes(l) ? "true" : undefined} className={cn("inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-xs font-medium", chosen.includes(l) ? "bg-white/[0.14] text-[var(--ds-on-surface)]" : "bg-white/[0.04] text-[var(--ds-on-surface-muted)] hover:bg-white/[0.08]")}>{LAYERS[l]}</Link>
            ))}
          </nav>
        ) : null}
        {view === "agenda" ? <Agenda items={items} anchor={anchor} today={today} url={url} empty={empty} /> : null}
        {view === "month" ? <Month items={items} anchor={anchor} today={today} url={url} /> : null}
        {view === "week" ? <Week items={items} anchor={anchor} today={today} /> : null}
        {view === "year" ? <Year items={items} anchor={anchor} today={today} url={url} /> : null}
      </div>
    </>
  );
}
