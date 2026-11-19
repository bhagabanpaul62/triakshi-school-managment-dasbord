"use client";

import { useState } from "react";
import { BANDS } from "../presets";
import { saveClasses } from "./actions";
import { StepFooter, useStepRun } from "./wizard";

const COUNTS = [1, 2, 3, 4];
const sectionLabel = (n: number) => (n === 1 ? "A" : `A-${String.fromCharCode(64 + n)}`);
const QUICK = [
  { label: "Nursery to Class 5", from: -2, to: 5 },
  { label: "Class 1 to 8", from: 1, to: 8 },
  { label: "Class 1 to 10", from: 1, to: 10 },
  { label: "Class 1 to 12", from: 1, to: 12 },
];

const chip = (on: boolean) =>
  `inline-flex min-h-10 items-center rounded-full px-4 text-sm transition-[background-color,transform] duration-150 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] ${on ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary)]" : "bg-white/[0.06] text-[var(--ds-on-surface-variant)] hover:bg-white/[0.1]"}`;

/** Classes as toggles, grouped by stage, each with how many sections it has. Starts from what exists, or Class 1 to 10 with sections A-B. */
export function ClassesPicker({ presets, existing, next, back }: {
  presets: { grade: number; name: string }[]; existing: Record<number, number>; next: string; back: string | null;
}) {
  const hadAny = Object.keys(existing).length > 0;
  const [picked, setPicked] = useState<Record<number, number>>(() =>
    hadAny ? Object.fromEntries(Object.entries(existing).map(([g, n]) => [Number(g), Math.max(1, n)]))
      : Object.fromEntries(presets.filter((p) => p.grade >= 1 && p.grade <= 10).map((p) => [p.grade, 2])));
  const { pending, errors, run } = useStepRun(next);
  const grades = Object.keys(picked).map(Number);
  const sections = Object.values(picked).reduce((a, b) => a + b, 0);

  const toggle = (g: number) => setPicked((s) => { const c = { ...s }; if (g in c) delete c[g]; else c[g] = 2; return c; });
  const setCount = (g: number, n: number) => setPicked((s) => ({ ...s, [g]: n }));
  const range = (from: number, to: number) => setPicked(Object.fromEntries(presets.filter((p) => p.grade >= from && p.grade <= to).map((p) => [p.grade, picked[p.grade] ?? 2])));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--ds-on-surface-muted)]">Quick pick</span>
        {QUICK.map((q) => <button key={q.label} type="button" className={chip(false)} onClick={() => range(q.from, q.to)}>{q.label}</button>)}
        <button type="button" className="min-h-10 px-3 text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]" onClick={() => setPicked({})}>Clear</button>
      </div>
      <div className="mt-6 flex flex-col gap-6">
        {BANDS.map((b) => {
          const rows = presets.filter((p) => p.grade >= b.min && p.grade <= b.max);
          if (!rows.length) return null;
          return (
            <section key={b.key} aria-label={b.label}>
              <h2 className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{b.label}</h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {rows.map((p) => {
                  const on = p.grade in picked;
                  return (
                    <li key={p.grade} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.03] px-3 py-2">
                      <button type="button" aria-pressed={on} onClick={() => toggle(p.grade)} className={chip(on)}>{p.name}</button>
                      {on ? (
                        <div role="group" aria-label={`Sections in ${p.name}`} className="flex gap-1">
                          {COUNTS.map((n) => (
                            <button key={n} type="button" aria-pressed={picked[p.grade] === n} onClick={() => setCount(p.grade, n)} title={`Sections ${sectionLabel(n)}`}
                              className={`h-10 min-w-10 rounded-full px-2 text-xs transition-colors duration-150 ${picked[p.grade] === n ? "bg-white/[0.16] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)] hover:bg-white/[0.06]"}`}>
                              {sectionLabel(n)}
                            </button>
                          ))}
                        </div>
                      ) : <span className="text-xs text-[var(--ds-on-surface-muted)]">Not offered</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
      {errors.picks ? <p role="alert" className="mt-4 text-sm text-[var(--ds-color-danger-300)]">{errors.picks}</p> : null}
      <p className="mt-4 text-xs text-[var(--ds-on-surface-muted)]">Classes and sections you already have are kept. Add more later in Academics.</p>
      <StepFooter back={back} label={hadAny ? "Save and continue" : "Create classes"} pending={pending} disabled={!grades.length}
        summary={grades.length ? `${grades.length} ${grades.length === 1 ? "class" : "classes"}, ${sections} sections` : "Pick at least one class"}
        onClick={() => run(() => saveClasses({ picks: grades.map((grade) => ({ grade, sections: picked[grade]! })) }))} />
    </div>
  );
}
