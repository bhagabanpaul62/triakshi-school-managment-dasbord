"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconArrowDown, IconArrowUp, IconTrash } from "@tabler/icons-react";
import { Button } from "@smw/ui/ui/button";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { Money } from "@smw/ui/finance/Money";
import { toast } from "@smw/ui/shell/toast";
import { computePay, type EngineComponent, type PayRates } from "../engine";

export interface EditorComponent { label: string; kind: "earning" | "deduction" | "employer"; mode: "fixed" | "percent_of_basic" | "percent_of_gross" | "remainder"; value: number; isBasic: boolean; isWage: boolean; proRata: boolean; taxable: boolean }
const OFF: PayRates = { pfCeilingSegments: [{ days: 30, paise: 0 }], pfEmployeeBp: 0, pfEmployerBp: 0, epsBp: 0, edliBp: 0, pfAdminBp: 0, wageExclusionBp: 5000, esiCeiling: 0, esiEmployeeBp: 0, esiEmployerBp: 0, pt: null, lwf: null, tax: null, config: { pf: false, esi: false, pt: false, lwf: false, tds: false } };
const BLANK: EditorComponent = { label: "", kind: "earning", mode: "fixed", value: 0, isBasic: false, isWage: false, proRata: true, taxable: true };
const KIND = { earning: "Earning", deduction: "Deduction", employer: "Employer cost" };
const MODE = { fixed: "Fixed amount", percent_of_basic: "% of basic", percent_of_gross: "% of gross", remainder: "Rest of the gross" };
const shown = (c: EditorComponent) => (c.mode === "fixed" ? c.value / 100 : c.value / 100);

/** Build a pay structure and see what a sample gross turns into, line by line, before saving. A structure people are paid by is read only: copy it to change it. */
export function StructureEditor({ id, name: initialName, components: initial, locked, save, copy }: { id?: string; name: string; components: EditorComponent[]; locked: boolean; save: (fd: FormData) => Promise<FormResult>; copy?: (fd: FormData) => Promise<FormResult> }) {
  const [name, setName] = useState(initialName), [rows, setRows] = useState<EditorComponent[]>(initial.length ? initial : [{ ...BLANK, label: "Basic", mode: "percent_of_gross", value: 5000, isBasic: true, isWage: true }, { ...BLANK, label: "Allowance", mode: "remainder" }]);
  const [gross, setGross] = useState(30000), [pending, start] = useTransition();
  const router = useRouter();
  const patch = (i: number, p: Partial<EditorComponent>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => setRows((r) => { const n = [...r]; const j = i + d; if (j < 0 || j >= n.length) return r; [n[i], n[j]] = [n[j]!, n[i]!]; return n; });
  const preview = useMemo(() => computePay({
    assignment: { grossPaise: Math.round(gross * 100) }, days: { calendarDays: 30, unpaidHalfDays: 0 }, month: "2026-11-01", rates: OFF,
    profile: { pan: true, regime: "new", pfApplies: null, esiApplies: null, ptApplies: null, pfOnFullWages: false },
    components: rows.map((c, i): EngineComponent => ({ id: String(i), sort: i, ...c, label: c.label || `Component ${i + 1}` })),
  }), [rows, gross]);
  const send = (action: (fd: FormData) => Promise<FormResult>, extra: Record<string, string>, to?: (id: string) => string) => start(async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    const r = await action(fd);
    if (r.ok) { toast(r.message ?? "Saved"); const newId = (r.data as { id?: string } | undefined)?.id; router.push(to && newId ? to(newId) : "/app/payroll/structures"); router.refresh(); } else toast(r.error, "danger");
  });
  const payload = JSON.stringify({ name, components: rows.map((c) => ({ ...c, label: c.label.trim() })) });
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="flex flex-col gap-4 lg:col-span-7">
        <label className="flex flex-col gap-1.5 text-sm"><span className="text-[var(--ds-on-surface-variant)]">Name</span><input value={name} onChange={(e) => setName(e.target.value)} disabled={locked} className={INPUT} placeholder="Teaching staff" /></label>
        <ul className="flex flex-col gap-3">
          {rows.map((c, i) => (
            <li key={i} className="rounded-2xl bg-white/[0.04] p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <input aria-label="Component name" placeholder="Name" value={c.label} disabled={locked} onChange={(e) => patch(i, { label: e.target.value })} className={`${INPUT} col-span-2`} />
                <select aria-label="Kind" value={c.kind} disabled={locked} onChange={(e) => patch(i, { kind: e.target.value as EditorComponent["kind"] })} className={INPUT}>{Object.entries(KIND).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <select aria-label="How it is worked out" value={c.mode} disabled={locked} onChange={(e) => patch(i, { mode: e.target.value as EditorComponent["mode"] })} className={INPUT}>{Object.entries(MODE).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                {c.mode !== "remainder" ? <input aria-label={c.mode === "fixed" ? "Amount in rupees" : "Percent"} type="number" step="0.01" min="0" value={shown(c)} disabled={locked} onChange={(e) => patch(i, { value: Math.round(Number(e.target.value) * 100) })} className={INPUT} /> : null}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                {c.kind === "earning" ? <>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={c.isBasic} disabled={locked} onChange={(e) => setRows((r) => r.map((x, j) => ({ ...x, isBasic: j === i ? e.target.checked : false })))} className="accent-[var(--ds-primary)]" />Basic</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={c.isWage} disabled={locked} onChange={(e) => patch(i, { isWage: e.target.checked })} className="accent-[var(--ds-primary)]" />Counts as wages (PF)</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={c.taxable} disabled={locked} onChange={(e) => patch(i, { taxable: e.target.checked })} className="accent-[var(--ds-primary)]" />Taxable</label>
                </> : null}
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={c.proRata} disabled={locked} onChange={(e) => patch(i, { proRata: e.target.checked })} className="accent-[var(--ds-primary)]" />Cut for unpaid days</label>
                {!locked ? <span className="ml-auto flex gap-1">
                  <button type="button" aria-label="Move up" onClick={() => move(i, -1)} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/[0.08]"><IconArrowUp className="h-4 w-4" /></button>
                  <button type="button" aria-label="Move down" onClick={() => move(i, 1)} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/[0.08]"><IconArrowDown className="h-4 w-4" /></button>
                  <button type="button" aria-label={`Remove ${c.label || "component"}`} onClick={() => setRows((r) => r.filter((_, j) => j !== i))} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-[var(--ds-color-danger-500)]/15"><IconTrash className="h-4 w-4" /></button>
                </span> : null}
              </div>
            </li>
          ))}
        </ul>
        {!locked ? <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" className="rounded-full" onClick={() => setRows((r) => [...r, { ...BLANK }])}>Add a component</Button>
          <Button type="button" className="rounded-full" isLoading={pending} onClick={() => send(save, { payload, ...(id ? { id } : {}) }, (n) => `/app/payroll/structures?edit=${n}`)}>Save the structure</Button></div>
          : <div className="flex flex-col gap-2 text-sm"><p className="text-[var(--ds-on-surface-muted)]">People are paid by this structure, so it cannot change. Copy it and change the copy; move people over from their pay page.</p>{copy && id ? <div><Button type="button" className="rounded-full" isLoading={pending} onClick={() => send(copy, { id }, (n) => `/app/payroll/structures?edit=${n}`)}>Copy to change</Button></div> : null}</div>}
      </div>
      <aside aria-label="Preview" className="lg:col-span-5">
        <div className="rounded-3xl bg-[var(--ds-surface-container-low)] p-5">
          <label className="flex flex-col gap-1.5 text-sm"><span className="text-[var(--ds-on-surface-variant)]">Try a gross pay of (rupees a month)</span><input type="number" min="0" value={gross} onChange={(e) => setGross(Number(e.target.value))} className={INPUT} /></label>
          <ul className="mt-4 flex flex-col gap-1.5 text-sm">{preview.lines.map((l) => <li key={l.sort} className="flex justify-between gap-3"><span className={l.kind === "employer" ? "text-[var(--ds-on-surface-muted)]" : ""}>{l.label}{l.kind !== "earning" ? <span className="ml-2 text-xs text-[var(--ds-on-surface-muted)]">{KIND[l.kind].toLowerCase()}</span> : null}</span><Money paise={l.kind === "deduction" ? -l.amountPaise : l.amountPaise} /></li>)}</ul>
          <div className="mt-4 flex justify-between border-t border-white/[0.08] pt-3 text-sm font-medium"><span>Gross</span><Money paise={preview.grossPaise} /></div>
          {preview.flags.filter((f) => f.code === "gross_mismatch" || f.code === "no_basic").map((f) => <p key={f.code} role="alert" className="mt-3 text-xs text-[var(--ds-color-warning-400)]">{f.message}</p>)}
          <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">Provident fund, ESI and tax are added on top of this when a run is worked out.</p>
        </div>
      </aside>
    </div>
  );
}
