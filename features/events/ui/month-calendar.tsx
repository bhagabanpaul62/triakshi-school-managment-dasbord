"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Panel } from "@smw/ui/kit/Panel";
import { Modal, ModalFooter } from "@smw/ui/kit/Modal";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { LABEL, TONE, ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { cn } from "@smw/ui/utils";
import { addDays, istDay, shiftMonth } from "../dates";
import { EventActions } from "./event-actions";
import { AUDIENCE_LABELS, type EventView } from "./fields";
import { whenLabel } from "./when";

const Chevron = ({ d }: { d: string }) => <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS = 3;
const NAV = "flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] text-[var(--ds-on-surface-variant)] transition-colors hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";

type Selection = { kind: "event"; id: string } | { kind: "day"; key: string } | null;

/** The month grid, built from kit tokens. Events are chips on the days they cover; a click opens the details. */
export function MonthCalendar({ month, today, events, canWrite, classes }: { month: string; today: string; events: EventView[]; canWrite: boolean; classes: { value: string; label: string }[] }) {
  const [sel, setSel] = useState<Selection>(null);
  const [y, m] = month.split("-").map(Number) as [number, number];
  const title = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

  const days = useMemo(() => {
    const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // Monday first
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)] as (string | null)[];
  }, [month, y, m]);

  const byDay = useMemo(() => {
    const map = new Map<string, EventView[]>();
    for (const e of events) {
      const last = istDay(e.endsAt ?? e.startsAt);
      for (let d = istDay(e.startsAt); d <= last; d = addDays(d, 1)) map.set(d, [...(map.get(d) ?? []), e]);
    }
    return map;
  }, [events]);

  const picked = sel?.kind === "event" ? events.find((e) => e.id === sel.id) : null;
  const dayEvents = sel?.kind === "day" ? byDay.get(sel.key) ?? [] : [];
  const close = () => setSel(null);

  return (
    <Panel title={title} action={
      <>
        <Link href={`?view=month&month=${shiftMonth(month, -1)}`} className={NAV} aria-label="Previous month" title="Previous month"><Chevron d="M10 3 5 8l5 5" /></Link>
        <Link href="?view=month" className="rounded-full bg-white/[0.06] px-3 py-1.5 text-xs text-[var(--ds-on-surface-variant)] transition-colors hover:bg-white/[0.12]">Today</Link>
        <Link href={`?view=month&month=${shiftMonth(month, 1)}`} className={NAV} aria-label="Next month" title="Next month"><Chevron d="m6 3 5 5-5 5" /></Link>
      </>
    }>
      <div role="grid" aria-label={title} className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {WEEKDAYS.map((d) => <div key={d} role="columnheader" className={cn(LABEL, "pb-1 text-center")}>{d}</div>)}
        {days.map((key, i) => {
          if (!key) return <div key={`blank-${i}`} role="gridcell" aria-hidden className="min-h-14 sm:min-h-28" />;
          const list = byDay.get(key) ?? [];
          const isToday = key === today;
          return (
            <div key={key} role="gridcell" className={cn("flex min-h-14 min-w-0 flex-col gap-1 rounded-xl p-1 sm:min-h-28 sm:p-2", isToday ? "bg-[var(--ds-color-primary-500)]/15" : "bg-white/[0.035]")}>
              <span className={cn("text-xs tabular-nums", isToday ? "font-medium text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)]")} aria-current={isToday ? "date" : undefined}>{Number(key.slice(8))}</span>
              {list.length ? (
                <>
                  <button type="button" onClick={() => setSel({ kind: "day", key })} aria-label={`${list.length} events on ${key.slice(8)} ${title}`}
                    className="flex flex-wrap gap-1 sm:hidden">
                    {list.slice(0, 4).map((e) => <span key={e.id} className={cn("h-1.5 w-1.5 rounded-full", TONE[e.tone].dot)} />)}
                  </button>
                  <div className="hidden min-w-0 flex-col gap-1 sm:flex">
                    {list.slice(0, MAX_CHIPS).map((e) => (
                      <button key={e.id} type="button" onClick={() => setSel({ kind: "event", id: e.id })} title={e.title}
                        className={cn("w-full truncate rounded-md px-1.5 py-0.5 text-left text-[11px] transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]", TONE[e.tone].chip)}>
                        {e.title}
                      </button>
                    ))}
                    {list.length > MAX_CHIPS ? (
                      <button type="button" onClick={() => setSel({ kind: "day", key })} className="text-left text-[11px] text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">+{list.length - MAX_CHIPS} more</button>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      {events.length === 0 ? <p className="mt-4 text-sm text-[var(--ds-on-surface-muted)]">Nothing is scheduled this month.</p> : null}

      <Modal open={!!picked} onOpenChange={(o) => !o && close()} size="sm" title={picked?.title ?? ""} description={picked ? whenLabel(picked) : undefined}
        footer={<ModalFooter secondary={{ label: "Close", onClick: close }} extra={picked && canWrite ? <EventActions event={picked} classes={classes} /> : undefined} />}>
        {picked ? (
          <div className="flex flex-col gap-3 pt-2">
            <div className="flex flex-wrap gap-2">
              {picked.isHoliday ? <ToneBadge label="Holiday" tone="warning" /> : null}
              {picked.isPublic ? <ToneBadge label="Public" tone="info" /> : null}
            </div>
            {picked.description ? <p className="text-sm text-[var(--ds-on-surface-variant)]">{picked.description}</p> : null}
            <FactList>
              <Fact label="When">{whenLabel(picked)}</Fact>
              <Fact label="Where">{picked.location}</Fact>
              <Fact label="Who">{picked.audience === "class" ? classes.find((c) => c.value === picked.classId)?.label ?? "One class" : AUDIENCE_LABELS[picked.audience]}</Fact>
            </FactList>
          </div>
        ) : null}
      </Modal>

      <Modal open={sel?.kind === "day"} onOpenChange={(o) => !o && close()} size="sm" title={sel?.kind === "day" ? `${Number(sel.key.slice(8))} ${title}` : ""}
        footer={<ModalFooter secondary={{ label: "Close", onClick: close }} />}>
        <ul className="flex flex-col gap-1 pt-2">
          {dayEvents.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => setSel({ kind: "event", id: e.id })} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/[0.04]">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", TONE[e.tone].dot)} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm">{e.title}</span>
                <span className="shrink-0 text-xs text-[var(--ds-on-surface-muted)]">{whenLabel(e)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </Panel>
  );
}
