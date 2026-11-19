"use client";

import { Inset, Panel } from "@smw/ui/kit/Panel";
import { dayName, formatTime, nowAndNext } from "../bell";
import { useClock } from "../clock";
import type { GridCell, PeriodView, Timetable } from "../service";

type Hit = { day: number; period: PeriodView; cell: GridCell };

function Lesson({ label, hit, when, perspective, accent }: { label: string; hit: Hit | null; when?: string; perspective: "section" | "teacher"; accent?: boolean }) {
  if (!hit) return (
    <Inset className="flex min-h-[104px] flex-col justify-between gap-2">
      <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{label}</p>
      <p className="text-sm text-[var(--ds-on-surface-muted)]">{when}</p>
    </Inset>
  );
  const who = perspective === "teacher" ? hit.cell.section : hit.cell.teacher;
  return (
    <Inset className="flex min-h-[104px] flex-col justify-between gap-2">
      <p className={`font-mono text-[11px] uppercase tracking-[0.05em] ${accent ? "text-[var(--ds-color-primary-300)]" : "text-[var(--ds-on-surface-muted)]"}`}>{label}</p>
      <div className="min-w-0">
        <p className="truncate text-[22px] font-medium tracking-tight text-[var(--ds-on-surface)]">{hit.cell.subject}</p>
        <p className="truncate text-sm text-[var(--ds-on-surface-variant)]">{[who, hit.cell.room].filter(Boolean).join(" · ")}</p>
      </div>
      <p className="text-xs text-[var(--ds-on-surface-muted)]">{when}</p>
    </Inset>
  );
}

/** "Now" and "Next" for a person's own week: the class in progress and what comes after. Rendered after mount so it uses the viewer's clock. */
export function NowNext({ timetable, perspective }: { timetable: Timetable; perspective: "section" | "teacher" }) {
  const clock = useClock();
  if (!clock) return <div className="mb-3 h-[200px] rounded-3xl bg-[var(--ds-surface-container-low)]" aria-hidden />;
  const { now, next } = nowAndNext(timetable.periods, timetable.cells, clock);
  const nextWhen = next ? `${next.today ? "Today" : dayName(next.day)}, ${formatTime(next.period.startsAt)} to ${formatTime(next.period.endsAt)}` : "Nothing else planned this week";
  return (
    <div className="mb-3">
      <Panel title="Right now">
        <div className="grid gap-3 sm:grid-cols-2">
          <Lesson label="Now" accent hit={now} perspective={perspective}
            when={now ? `Until ${formatTime(now.period.endsAt)}` : next?.today ? "No class right now" : "No more classes today"} />
          <Lesson label="Next" hit={next} perspective={perspective} when={nextWhen} />
        </div>
      </Panel>
    </div>
  );
}
