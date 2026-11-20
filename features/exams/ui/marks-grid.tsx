"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { cn } from "@smw/ui/utils";

type Part = { marks: number | null; absent: boolean };
type Row = { studentId: string; name: string; rollNo: number | null; sectionName: string; marks: number | null; absent: boolean; parts?: Record<string, Part> };
type Component = { id: string; name: string; maxMarks: number };
/** `parts` holds one text per component when the paper is split (Theory, Internal...); `marks` is then the sum. */
type Cell = { marks: string; absent: boolean; parts: Record<string, string> };

const fromRow = (r: Row): Cell => ({ marks: r.marks === null ? "" : String(r.marks), absent: r.absent, parts: Object.fromEntries(Object.entries(r.parts ?? {}).map(([id, p]) => [id, p.marks === null ? "" : String(p.marks)])) });

/** Marks entry grid: Enter or the arrow keys move between students, one save button with the count of what is in. */
export function MarksGrid({ paperId, maxMarks, passMarks, rows, editable, locked, action, components = [], homework = {} }: {
  paperId: string; maxMarks: number; passMarks: number; rows: Row[]; editable: boolean; locked: boolean; components?: Component[];
  /** Each student's graded-homework share (0 to 1) in this subject this term: fills a component on request. */
  homework?: Record<string, { pct: number; graded: number }>;
  action: (fd: FormData) => Promise<FormResult>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const saved = useMemo(() => Object.fromEntries(rows.map((r) => [r.studentId, fromRow(r)])) as Record<string, Cell>, [rows]);
  const [cells, setCells] = useState<Record<string, Cell>>(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inputs = useRef<Map<string, HTMLInputElement>>(new Map());

  /** Put each student's homework share into one component, scaled to its max and rounded to the half mark. Nothing is saved until Save. */
  const fillFromHomework = (k: Component) => {
    let n = 0;
    const next = { ...cells };
    for (const r of rows) {
      const h = homework[r.studentId], c = next[r.studentId];
      if (!h || !c || c.absent) continue;
      next[r.studentId] = { ...c, parts: { ...c.parts, [k.id]: String(Math.round(h.pct * k.maxMarks * 2) / 2) } };
      n++;
    }
    setCells(next);
    toast(n ? `${k.name} filled for ${n} students from graded homework. Check, then save.` : "No graded homework in this subject this term yet.");
  };
  const hasHomework = Object.keys(homework).length > 0;

  const set = (id: string, patch: Partial<Cell>) => {
    setCells((c) => ({ ...c, [id]: { ...c[id]!, ...patch } }));
    setErrors((e) => { if (!e[id]) return e; const { [id]: _drop, ...rest } = e; return rest; });
  };
  const split = components.length > 0;
  const filled = (c: Cell) => components.filter((k) => (c.parts[k.id] ?? "").trim() !== "");
  /** The paper total of a split paper: the sum of its parts. */
  const total = (c: Cell) => components.reduce((n, k) => n + (Number(c.parts[k.id]) || 0), 0);
  const problem = (c: Cell) => {
    if (c.absent) return null;
    if (split) {
      const got = filled(c);
      if (got.length === 0) return null;
      const over = got.find((k) => { const n = Number(c.parts[k.id]); return !Number.isFinite(n) || n < 0 || n > k.maxMarks; });
      return over ? `${over.name}: 0 to ${over.maxMarks}` : got.length < components.length ? "Enter every part" : null;
    }
    if (c.marks.trim() === "") return null;
    const n = Number(c.marks);
    return !Number.isFinite(n) || n < 0 || n > maxMarks ? `Enter 0 to ${maxMarks}` : null;
  };
  const same = (a: Cell, b: Cell) => a.absent === b.absent && (split ? components.every((k) => (a.parts[k.id] ?? "") === (b.parts[k.id] ?? "")) : a.marks === b.marks);
  const dirty = rows.filter((r) => !same(cells[r.studentId]!, saved[r.studentId]!)).length;
  const absent = rows.filter((r) => cells[r.studentId]!.absent).length;
  const entered = rows.filter((r) => !cells[r.studentId]!.absent && (split ? filled(cells[r.studentId]!).length > 0 : cells[r.studentId]!.marks !== "")).length;

  const saveBtn = useRef<HTMLButtonElement>(null);
  const focusFrom = (index: number, step: 1 | -1) => {
    for (let i = index + step; i >= 0 && i < rows.length; i += step) {
      const el = inputs.current.get(rows[i]!.studentId);
      if (el && !el.disabled) { el.focus(); el.select(); return; }
    }
    if (step === 1) saveBtn.current?.focus(); // last student: next stop is Save
  };

  const invalid = rows.filter((r) => problem(cells[r.studentId]!)).length;
  const save = () => {
    const bad: Record<string, string> = {};
    const entries = rows.map((r) => {
      const c = cells[r.studentId]!;
      const n = c.marks.trim() === "" ? null : Number(c.marks);
      const why = problem(c);
      if (why) bad[r.studentId] = why;
      const components_ = split ? components.map((k) => ({ componentId: k.id, marks: (c.parts[k.id] ?? "").trim() === "" ? null : Number(c.parts[k.id]), absent: false })) : undefined;
      return { studentId: r.studentId, marks: c.absent || split ? null : n, absent: c.absent, components: c.absent ? undefined : components_ };
    });
    setErrors(bad);
    if (Object.keys(bad).length) { toast(`Fix ${Object.keys(bad).length === 1 ? "the mark" : "the marks"} shown in red first.`, "danger"); return; }
    const fd = new FormData();
    fd.set("paperId", paperId);
    fd.set("entries", JSON.stringify(entries));
    start(async () => {
      const r = await action(fd);
      if (r.ok) { toast(`All saved: ${entered} marks${absent ? `, ${absent} absent` : ""}`); router.refresh(); } else { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); }
    });
  };

  if (rows.length === 0) return <Panel><WidgetEmptyState title="No students in this class yet." description="Students appear here once they are admitted to a section." /></Panel>;

  return (
    <div className="flex flex-col gap-3">
      {!editable ? (
        <p role="status" className="rounded-2xl bg-white/[0.05] px-4 py-3 text-sm text-[var(--ds-on-surface-variant)]">
          {locked ? "Results are published, so these marks are locked." : "Marks entry is not open for this exam yet."}
        </p>
      ) : null}
      {editable && split && hasHomework ? (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/[0.04] px-4 py-3">
          <p className="mr-auto text-sm text-[var(--ds-on-surface-variant)]">Homework marks for {Object.keys(homework).length} students are ready to use as internal marks.</p>
          {components.map((k) => <Button key={k.id} type="button" variant="secondary" size="sm" onClick={() => fillFromHomework(k)}>Fill {k.name} from homework</Button>)}
        </div>
      ) : null}
      <Panel>
        <ul className="flex flex-col">
          {rows.map((r, i) => {
            const c = cells[r.studentId]!;
            const n = split ? (filled(c).length === components.length ? total(c) : null) : c.marks.trim() === "" ? null : Number(c.marks);
            const failing = !problem(c) && !c.absent && n !== null && n < passMarks;
            const err = errors[r.studentId] ?? problem(c);
            return (
              <li key={r.studentId} className={cn("grid items-center gap-3 rounded-2xl px-2 py-2 transition-colors duration-150 hover:bg-white/[0.04]", split ? "grid-cols-[2.25rem_minmax(0,1fr)] sm:grid-cols-[2.25rem_minmax(0,1fr)_auto_auto]" : "grid-cols-[2.25rem_minmax(0,1fr)_6.5rem_auto]")}>
                <span className="text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{r.rollNo ?? "-"}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-[var(--ds-on-surface)]">{r.name}</span>
                  <span className="block text-xs text-[var(--ds-on-surface-muted)]">Section {r.sectionName}{err ? <span className="ml-2 text-[var(--ds-color-danger-400)]" role="alert">{err}</span> : null}</span>
                </span>
                {split ? (
                  <span className="col-span-2 flex flex-wrap items-end justify-end gap-2 sm:col-span-1">
                    {components.map((k) => (
                      <label key={k.id} className="flex w-20 flex-col gap-0.5 text-[11px] text-[var(--ds-on-surface-muted)]">
                        {k.name} /{k.maxMarks}
                        <input type="number" inputMode="decimal" min={0} max={k.maxMarks} step="0.5" value={c.absent ? "" : c.parts[k.id] ?? ""} disabled={!editable || c.absent}
                          aria-label={`${k.name} marks for ${r.name}`} aria-invalid={err ? true : undefined}
                          onChange={(e) => set(r.studentId, { parts: { ...c.parts, [k.id]: e.target.value } })} onFocus={(e) => e.currentTarget.select()} className={cn(INPUT, "text-right tabular-nums")} />
                      </label>
                    ))}
                    <span className="w-16 pb-2 text-right text-sm tabular-nums text-[var(--ds-on-surface)]" aria-label={`Total for ${r.name}`}>{c.absent ? "AB" : n === null ? "-" : `${Math.round(n * 100) / 100}`}</span>
                  </span>
                ) : (
                  <input
                    ref={(el) => { if (el) inputs.current.set(r.studentId, el); else inputs.current.delete(r.studentId); }}
                    type="number" inputMode="decimal" min={0} max={maxMarks} step="0.5"
                    value={c.absent ? "" : c.marks} disabled={!editable || c.absent} placeholder={c.absent ? "AB" : `/ ${maxMarks}`}
                    aria-label={`Marks for ${r.name}`} aria-invalid={err ? true : undefined}
                    onChange={(e) => set(r.studentId, { marks: e.target.value })}
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); focusFrom(i, 1); }
                      else if (e.key === "ArrowUp") { e.preventDefault(); focusFrom(i, -1); }
                    }}
                    className={cn(INPUT, "text-right tabular-nums")}
                />
                )}
                <span className={cn("flex items-center justify-end gap-2", split && "col-span-2 sm:col-span-1")}>
                  {failing ? <ToneBadge label="Below pass" tone="danger" /> : null}
                  <button type="button" disabled={!editable} aria-pressed={c.absent} aria-label={`Mark ${r.name} absent`} title="Absent"
                    onClick={() => set(r.studentId, { absent: !c.absent, marks: "", parts: {} })}
                    className={cn("h-10 rounded-full px-3 text-xs transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] disabled:opacity-40",
                      c.absent ? "bg-[var(--ds-color-warning-500)]/20 text-[var(--ds-color-warning-400)]" : "bg-white/[0.06] text-[var(--ds-on-surface-variant)] hover:bg-white/[0.1]")}>
                    Absent
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>
      {editable ? (
        <div className="sticky bottom-4 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-[var(--ds-surface-container)] p-4">
          <p className="text-sm text-[var(--ds-on-surface-variant)]" aria-live="polite">
            <span className="tabular-nums text-[var(--ds-on-surface)]">{entered}</span> of {rows.length} entered
            {absent ? <> · <span className="tabular-nums">{absent}</span> absent</> : null}
            {dirty ? <> · <span className="tabular-nums">{dirty}</span> unsaved</> : entered ? <> · all saved</> : null}
            {invalid ? <> · <span className="tabular-nums text-[var(--ds-color-danger-400)]">{invalid}</span> to fix</> : null}
          </p>
          <Button ref={saveBtn} type="button" className="rounded-full" onClick={save} isLoading={pending} disabled={!dirty || invalid > 0}>{dirty ? `Save marks (${dirty})` : "Save marks"}</Button>
        </div>
      ) : null}
    </div>
  );
}
