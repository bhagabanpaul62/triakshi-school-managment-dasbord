"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { cn } from "@smw/ui/utils";

type Row = { studentId: string; name: string; rollNo: number | null; sectionName: string; marks: number | null; absent: boolean };
type Cell = { marks: string; absent: boolean };

const fromRow = (r: Row): Cell => ({ marks: r.marks === null ? "" : String(r.marks), absent: r.absent });

/** Marks entry grid: Enter or the arrow keys move between students, one save button with the count of what is in. */
export function MarksGrid({ paperId, maxMarks, passMarks, rows, editable, locked, action }: {
  paperId: string; maxMarks: number; passMarks: number; rows: Row[]; editable: boolean; locked: boolean;
  action: (fd: FormData) => Promise<FormResult>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const saved = useMemo(() => Object.fromEntries(rows.map((r) => [r.studentId, fromRow(r)])) as Record<string, Cell>, [rows]);
  const [cells, setCells] = useState<Record<string, Cell>>(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inputs = useRef<Map<string, HTMLInputElement>>(new Map());

  const set = (id: string, patch: Partial<Cell>) => {
    setCells((c) => ({ ...c, [id]: { ...c[id]!, ...patch } }));
    setErrors((e) => { if (!e[id]) return e; const { [id]: _drop, ...rest } = e; return rest; });
  };
  const problem = (c: Cell) => {
    if (c.absent || c.marks.trim() === "") return null;
    const n = Number(c.marks);
    return !Number.isFinite(n) || n < 0 || n > maxMarks ? `Enter 0 to ${maxMarks}` : null;
  };
  const dirty = rows.filter((r) => cells[r.studentId]!.marks !== saved[r.studentId]!.marks || cells[r.studentId]!.absent !== saved[r.studentId]!.absent).length;
  const absent = rows.filter((r) => cells[r.studentId]!.absent).length;
  const entered = rows.filter((r) => !cells[r.studentId]!.absent && cells[r.studentId]!.marks !== "").length;

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
      return { studentId: r.studentId, marks: c.absent ? null : n, absent: c.absent };
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
      <Panel>
        <ul className="flex flex-col">
          {rows.map((r, i) => {
            const c = cells[r.studentId]!;
            const n = c.marks.trim() === "" ? null : Number(c.marks);
            const failing = !problem(c) && !c.absent && n !== null && n < passMarks;
            const err = errors[r.studentId] ?? problem(c);
            return (
              <li key={r.studentId} className="grid grid-cols-[2.25rem_minmax(0,1fr)_6.5rem_auto] items-center gap-3 rounded-2xl px-2 py-2 transition-colors duration-150 hover:bg-white/[0.04]">
                <span className="text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{r.rollNo ?? "-"}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-[var(--ds-on-surface)]">{r.name}</span>
                  <span className="block text-xs text-[var(--ds-on-surface-muted)]">Section {r.sectionName}{err ? <span className="ml-2 text-[var(--ds-color-danger-400)]" role="alert">{err}</span> : null}</span>
                </span>
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
                <span className="flex items-center justify-end gap-2">
                  {failing ? <ToneBadge label="Below pass" tone="danger" /> : null}
                  <button type="button" disabled={!editable} aria-pressed={c.absent} aria-label={`Mark ${r.name} absent`} title="Absent"
                    onClick={() => set(r.studentId, { absent: !c.absent, marks: "" })}
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
