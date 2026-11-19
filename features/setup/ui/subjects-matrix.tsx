"use client";

import { useState } from "react";
import { IconCheck } from "@tabler/icons-react";
import { BOARDS, SUBJECT_PRESETS, type Board } from "@smw/feature-academics/presets";
import { INPUT } from "@smw/ui/shell/FormModal";
import { BANDS, usualBands, type BandKey } from "../presets";
import { saveSubjects } from "./actions";
import { StepFooter, useStepRun } from "./wizard";

type Picks = Record<string, BandKey[]>;

/** Start from what the school already has, plus the stages a subject usually runs in. Only stages that have classes are shown. */
function defaults(board: Board, assigned: Picks, shown: BandKey[]): Picks {
  return Object.fromEntries(SUBJECT_PRESETS[board].map((s) => [s.name, [...new Set([...(assigned[s.name] ?? []), ...usualBands(s.name)])].filter((b) => shown.includes(b))]));
}

/** Subjects by stage of the school. Ticked cells are saved to every class of that stage; cells already saved are locked. */
export function SubjectsMatrix({ board: initial, bandCounts, assigned, next, back, skip }: {
  board: Board; bandCounts: Record<BandKey, number>; assigned: Picks; next: string; back: string | null; skip: string;
}) {
  const bands = BANDS.filter((b) => bandCounts[b.key] > 0);
  const shown = bands.map((b) => b.key);
  const [board, setBoard] = useState<Board>(initial);
  const [picks, setPicks] = useState<Picks>(() => defaults(initial, assigned, shown));
  const { pending, errors, run } = useStepRun(next);
  const locked = (name: string, b: BandKey) => assigned[name]?.includes(b) ?? false;

  const toggle = (name: string, b: BandKey) => {
    if (locked(name, b)) return;
    setPicks((p) => ({ ...p, [name]: p[name]?.includes(b) ? p[name].filter((x) => x !== b) : [...(p[name] ?? []), b] }));
  };
  const chosen = Object.entries(picks).filter(([, bs]) => bs.length);
  const pairs = chosen.reduce((n, [, bs]) => n + bs.reduce((m, b) => m + bandCounts[b], 0), 0);

  return (
    <div>
      <label className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-[var(--ds-on-surface-variant)]">Subject list for</span>
        <select value={board} onChange={(e) => { const b = e.target.value as Board; setBoard(b); setPicks(defaults(b, assigned, shown)); }} className={`${INPUT} w-auto`}>
          {BOARDS.map((b) => <option key={b} value={b}>{b === "State" ? "State board and others" : b}</option>)}
        </select>
      </label>
      <div className="-mx-1 mt-5 overflow-x-auto px-1">
        <table className="w-full min-w-[34rem] border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-left font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">
              <th scope="col" className="py-2 pr-3 font-normal">Subject</th>
              {bands.map((b) => (
                <th key={b.key} scope="col" className="px-2 py-2 text-center font-normal">{b.label}<span className="block normal-case tracking-normal">{bandCounts[b.key]} {bandCounts[b.key] === 1 ? "class" : "classes"}</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SUBJECT_PRESETS[board].map((s) => (
              <tr key={s.name} className="bg-white/[0.03]">
                <th scope="row" className="rounded-l-2xl py-2 pl-3 pr-3 text-left font-normal text-[var(--ds-on-surface)]">
                  {s.name}{s.kind === "co_scholastic" ? <span className="ml-2 text-[11px] text-[var(--ds-on-surface-muted)]">Co-scholastic</span> : null}
                </th>
                {bands.map((b, i) => {
                  const on = picks[s.name]?.includes(b.key) ?? false;
                  const fixed = locked(s.name, b.key);
                  return (
                    <td key={b.key} className={`px-2 py-1.5 text-center ${i === bands.length - 1 ? "rounded-r-2xl" : ""}`}>
                      <button type="button" aria-pressed={on} aria-label={`${s.name}, ${b.label}${fixed ? " (already added)" : ""}`} disabled={fixed} title={fixed ? "Already added. Change it in Academics." : undefined}
                        onClick={() => toggle(s.name, b.key)}
                        className={`mx-auto flex h-8 w-12 items-center justify-center rounded-full transition-[background-color,transform] duration-150 active:scale-[0.94] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] ${on ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary)]" : "bg-white/[0.06] hover:bg-white/[0.12]"} ${fixed ? "opacity-60" : ""}`}>
                        {on ? <IconCheck className="h-4 w-4" aria-hidden /> : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {errors.picks ? <p role="alert" className="mt-4 text-sm text-[var(--ds-color-danger-300)]">{errors.picks}</p> : null}
      <p className="mt-4 text-xs text-[var(--ds-on-surface-muted)]">Subjects already saved stay as they are. Teachers are assigned later, from Academics.</p>
      <StepFooter back={back} skip={skip} label="Save and continue" pending={pending} disabled={!chosen.length}
        summary={chosen.length ? `${chosen.length} subjects, ${pairs} class assignments` : "Tick at least one subject"}
        onClick={() => run(() => saveSubjects({ board, picks: chosen.map(([name, bs]) => ({ name, bands: bs })) }))} />
    </div>
  );
}
