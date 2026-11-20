"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SegmentedControl } from "@smw/ui/kit/SegmentedControl";
import { DAYS, cellKey as key, dayName, formatTime, istMinutes, minutesOf, schoolDay, timeRange } from "../bell";
import { useClock } from "../clock";
import type { GridCell, PeriodView, Timetable } from "../service";
import { CellEditor, type EditorProps } from "./CellEditor";

const NOW = "bg-[color-mix(in_oklab,var(--ds-color-primary-400)_16%,transparent)]";
const CELL = "flex min-h-[64px] w-full min-w-0 flex-col justify-center gap-0.5 rounded-2xl px-3 py-2 text-left";

/** One cell: the subject, then who (section view) or where (teacher view), then the room. */
function Lesson({ cell, perspective }: { cell: GridCell; perspective: "section" | "teacher" }) {
  const second = perspective === "section" ? cell.teacher : cell.section;
  // An elective block seen whole (admin): its name, then one line per alternative.
  if (cell.blockId && (cell.options?.length ?? 0) > 1) return (
    <>
      <span className="truncate text-sm font-medium text-[var(--ds-on-surface)]">{cell.blockName}</span>
      {cell.options!.map((o) => <span key={o.optionId} className="truncate text-xs text-[var(--ds-on-surface-variant)]">{o.subject}{o.teacher ? ` (${o.teacher})` : ""}</span>)}
      {cell.locked ? <span className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-color-primary-300)]">Pinned</span> : null}
    </>
  );
  return (
    <>
      <span className="truncate text-sm font-medium text-[var(--ds-on-surface)]">{cell.subject}</span>
      {second ? <span className="truncate text-xs text-[var(--ds-on-surface-variant)]">{second}</span> : null}
      {cell.room ? <span className="truncate font-mono text-[11px] text-[var(--ds-on-surface-muted)]">Room {cell.room}</span> : null}
      {cell.locked ? <span className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-color-primary-300)]">Pinned</span> : null}
    </>
  );
}

/**
 * The week as a grid: days across, periods down. Read-only for everyone but the admin, who passes `editor` to click a cell.
 * Wide screens get the full grid (it scrolls inside its panel when narrow); phones get day tabs and one day at a time.
 */
export function TimetableGrid({ timetable, perspective, editor }: { timetable: Timetable; perspective: "section" | "teacher"; editor?: EditorProps }) {
  const router = useRouter();
  const [cells, setCells] = useState(timetable.cells);
  const clock = useClock();
  const today = clock ? schoolDay(clock) : null;
  const [picked, setPicked] = useState<number | null>(null);
  const day = picked ?? today ?? 1;
  const mins = clock ? istMinutes(clock) : -1;
  /** The period in progress right now; only today's column and rows light up. */
  const nowId = today ? timetable.periods.find((p) => !p.isBreak && minutesOf(p.startsAt) <= mins && mins < minutesOf(p.endsAt))?.id : undefined;
  const [editing, setEditing] = useState<{ day: number; period: PeriodView } | null>(null);

  useEffect(() => setCells(timetable.cells), [timetable.cells]);

  const done = (saved: GridCell | null) => {
    if (!editing) return;
    const k = key(editing.day, editing.period.id);
    setCells((c) => { const next = { ...c }; if (saved) next[k] = saved; else delete next[k]; return next; });
    setEditing(null);
    router.refresh();
  };

  const cellFor = (d: number, p: PeriodView) => {
    const cell = cells[key(d, p.id)];
    const live = d === today && p.id === nowId;
    if (!editor) {
      return cell
        ? <div className={`${CELL} ${live ? NOW : "bg-white/[0.05]"}`}><Lesson cell={cell} perspective={perspective} /></div>
        : <div className={`${CELL} text-xs text-[var(--ds-on-surface-muted)]`} aria-label={`${dayName(d)} ${p.name}: free`}>Free</div>;
    }
    return (
      <button type="button" onClick={() => setEditing({ day: d, period: p })}
        aria-label={`${dayName(d)}, ${p.name}: ${cell ? `${cell.subject}${cell.blockId ? "" : ` with ${cell.teacher ?? "no teacher"}`}. Edit` : "empty. Add a class"}`}
        className={`${CELL} transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] ${cell ? `${live ? NOW : "bg-white/[0.05]"} hover:bg-white/[0.09]` : "bg-white/[0.02] text-[var(--ds-on-surface-muted)] hover:bg-white/[0.06]"}`}>
        {cell ? <Lesson cell={cell} perspective={perspective} /> : <span className="text-xs">+ Add</span>}
      </button>
    );
  };

  const timeLabel = (p: PeriodView) => (
    <div className="flex min-w-0 flex-col justify-center px-1">
      <span className={`truncate text-[13px] ${p.id === nowId ? "text-[var(--ds-color-primary-300)]" : "text-[var(--ds-on-surface)]"}`}>{p.name}{p.id === nowId ? " · now" : ""}</span>
      <span className="font-mono text-[11px] text-[var(--ds-on-surface-muted)]">{formatTime(p.startsAt)}</span>
    </div>
  );
  const breakBar = (p: PeriodView) => (
    <div className="flex items-center justify-center rounded-2xl bg-white/[0.025] px-3 py-2 text-xs text-[var(--ds-on-surface-muted)]">
      {p.name} · {timeRange(p.startsAt, p.endsAt)}
    </div>
  );

  return (
    <>
      {/* Phones: one day at a time */}
      <div className="md:hidden">
        <div className="custom-scrollbar -mx-1 mb-4 overflow-x-auto px-1">
          <SegmentedControl label="Day" size="sm" value={String(day)} onChange={(v) => setPicked(Number(v))}
            options={DAYS.map((d) => ({ value: String(d.n), label: d.n === today ? `${d.short} (today)` : d.short }))} />
        </div>
        <ul className="flex flex-col gap-1.5">
          {timetable.periods.map((p) => (
            <li key={p.id} className={p.isBreak ? "" : "grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2"}>
              {p.isBreak ? breakBar(p) : <>{timeLabel(p)}{cellFor(day, p)}</>}
            </li>
          ))}
        </ul>
      </div>

      {/* Tablets and desktops: the full week, scrolling inside the panel when it does not fit */}
      <div className="custom-scrollbar hidden overflow-x-auto md:block">
        <div className="grid min-w-[760px] gap-1.5" style={{ gridTemplateColumns: "96px repeat(6, minmax(0, 1fr))" }}>
          <div />
          {DAYS.map((d) => (
            <div key={d.n} className="pb-1 text-center">
              <span className={`inline-block rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.05em] ${d.n === today ? `${NOW} text-[var(--ds-color-primary-300)]` : "text-[var(--ds-on-surface-muted)]"}`}>
                {d.short}{d.n === today ? " · today" : ""}
              </span>
            </div>
          ))}
          {timetable.periods.map((p) => p.isBreak ? (
            <div key={p.id} className="col-span-7">{breakBar(p)}</div>
          ) : (
            <div key={p.id} className="contents">
              {timeLabel(p)}
              {DAYS.map((d) => <div key={d.n} className="min-w-0">{cellFor(d.n, p)}</div>)}
            </div>
          ))}
        </div>
      </div>

      {editing && editor ? (
        <CellEditor key={key(editing.day, editing.period.id)} editor={editor} day={editing.day} period={editing.period}
          cell={cells[key(editing.day, editing.period.id)]} onDone={done} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}
