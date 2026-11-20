"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { COMPONENT_PRESETS, GradeScale } from "../grading";

type Action = (fd: FormData) => Promise<FormResult>;
type Option = { value: string; label: string };

/** Run a server action, toast the result, refresh the page, and keep the field errors the server sent back. */
function useSave(action: Action, okMessage: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const run = (fd: FormData) => start(async () => {
    const r = await action(fd);
    if (r.ok) { setErrors({}); toast(okMessage); router.refresh(); } else { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); }
  });
  return { pending, errors, run };
}
const fields = (o: Record<string, string>) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) fd.set(k, v); return fd; };
const Err = ({ text }: { text?: string }) => (text ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{text}</p> : null);
const ROW = "rounded-2xl bg-white/[0.03] p-3";
const LBL = "flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]";

// ---------- scholastic bands ----------

type BandRow = { grade: string; minPercent: string; maxPercent: string; gradePoint: string; remark: string };

export function BandsEditor({ scaleId, bands, action, canEdit }: { scaleId: string; bands: { grade: string; minPercent: number; maxPercent: number; gradePoint: number; remark: string | null }[]; action: Action; canEdit: boolean }) {
  const [rows, setRows] = useState<BandRow[]>(bands.map((b) => ({ grade: b.grade, minPercent: String(b.minPercent), maxPercent: String(b.maxPercent), gradePoint: String(b.gradePoint), remark: b.remark ?? "" })));
  const { pending, errors, run } = useSave(action, "Grades saved");
  const set = (i: number, patch: Partial<BandRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const parsed = rows.map((r) => ({ grade: r.grade.trim(), minPercent: Number(r.minPercent), maxPercent: Number(r.maxPercent), gradePoint: Number(r.gradePoint || 0), remark: r.remark.trim() }));
  const problem = rows.some((r) => !r.grade.trim()) ? "Name every grade" : parsed.some((b) => !Number.isInteger(b.minPercent) || !Number.isInteger(b.maxPercent)) ? "Percents must be whole numbers" : GradeScale.problem(parsed);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <div key={i} className={ROW}>
          <div className="grid grid-cols-[1fr_1fr_1fr_1fr_auto] items-end gap-2">
            <label className={LBL}>Grade<input className={INPUT} value={r.grade} disabled={!canEdit} maxLength={6} onChange={(e) => set(i, { grade: e.target.value })} /></label>
            <label className={LBL}>From %<input className={INPUT} type="number" inputMode="numeric" min={0} max={100} value={r.minPercent} disabled={!canEdit} onChange={(e) => set(i, { minPercent: e.target.value })} /></label>
            <label className={LBL}>To %<input className={INPUT} type="number" inputMode="numeric" min={0} max={100} value={r.maxPercent} disabled={!canEdit} onChange={(e) => set(i, { maxPercent: e.target.value })} /></label>
            <label className={LBL}>Point<input className={INPUT} type="number" inputMode="numeric" min={0} max={10} value={r.gradePoint} disabled={!canEdit} onChange={(e) => set(i, { gradePoint: e.target.value })} /></label>
            {canEdit ? <Button type="button" variant="ghost" size="sm" aria-label={`Remove grade ${r.grade}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Remove</Button> : <span />}
          </div>
          <label className={`${LBL} mt-2`}>Remark printed on the card<input className={INPUT} value={r.remark} disabled={!canEdit} maxLength={80} onChange={(e) => set(i, { remark: e.target.value })} /></label>
        </div>
      ))}
      <Err text={errors.bands ?? (rows.length ? problem ?? undefined : "Add at least one grade")} />
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" className="rounded-full" onClick={() => setRows((r) => [...r, { grade: "", minPercent: "0", maxPercent: "0", gradePoint: "0", remark: "" }])}>Add grade</Button>
          <Button type="button" className="rounded-full" isLoading={pending} disabled={!!problem || !rows.length} onClick={() => run(fields({ scaleId, bands: JSON.stringify(parsed.map((b) => ({ ...b, remark: b.remark || undefined }))) }))}>Save grades</Button>
        </div>
      ) : null}
    </div>
  );
}

// ---------- co-scholastic scale ----------

export function CoScaleEditor({ scale, action, removeAction, canEdit }: { scale?: { id: string; name: string; isDefault: boolean; grades: { grade: string; description: string }[] }; action: Action; removeAction: Action; canEdit: boolean }) {
  const [name, setName] = useState(scale?.name ?? "");
  const [isDefault, setDefault] = useState(scale?.isDefault ?? false);
  const [rows, setRows] = useState(scale?.grades ?? [{ grade: "A", description: "" }]);
  const { pending, errors, run } = useSave(action, "Co-scholastic scale saved");
  const del = useSave(removeAction, "Scale deleted");
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const bad = !name.trim() || rows.some((r) => !r.grade.trim() || !r.description.trim());
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className={LBL}>Scale name<input className={INPUT} value={name} disabled={!canEdit} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
        <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={isDefault} disabled={!canEdit} onChange={(e) => setDefault(e.target.checked)} className="h-4 w-4 accent-[var(--ds-primary)]" />Default</label>
      </div>
      <Err text={errors.name} />
      {rows.map((r, i) => (
        <div key={i} className={`${ROW} grid grid-cols-[4.5rem_1fr_auto] items-end gap-2`}>
          <label className={LBL}>Grade<input className={INPUT} value={r.grade} disabled={!canEdit} maxLength={6} onChange={(e) => set(i, { grade: e.target.value })} /></label>
          <label className={LBL}>Meaning<input className={INPUT} value={r.description} disabled={!canEdit} maxLength={60} onChange={(e) => set(i, { description: e.target.value })} /></label>
          {canEdit ? <Button type="button" variant="ghost" size="sm" aria-label={`Remove grade ${r.grade}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Remove</Button> : <span />}
        </div>
      ))}
      <Err text={errors.grades} />
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" className="rounded-full" onClick={() => setRows((r) => [...r, { grade: "", description: "" }])}>Add grade</Button>
          <Button type="button" className="rounded-full" isLoading={pending} disabled={bad} onClick={() => run(fields({ ...(scale ? { id: scale.id } : {}), name, ...(isDefault ? { isDefault: "true" } : {}), grades: JSON.stringify(rows) }))}>{scale ? "Save scale" : "Add scale"}</Button>
          {scale && !scale.isDefault ? <Button type="button" variant="ghost" className="rounded-full" isLoading={del.pending} onClick={() => del.run(fields({ id: scale.id }))}>Delete</Button> : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------- templates per class band ----------

export type TemplateRow = { classBand: string; saved: boolean; board: string; scaleId: string | null; coScaleId: string | null; showGrade: boolean; showRank: boolean; termSplit: number[] };

export function TemplateEditor({ template, scales, coScales, action, presetAction, canEdit }: { template: TemplateRow; scales: Option[]; coScales: Option[]; action: Action; presetAction: Action; canEdit: boolean }) {
  const [t, setT] = useState({ board: template.board, scaleId: template.scaleId ?? "", coScaleId: template.coScaleId ?? "", showGrade: template.showGrade, showRank: template.showRank, termSplit: template.termSplit.join(", ") });
  const { pending, errors, run } = useSave(action, "Report setup saved");
  const preset = useSave(presetAction, "ICSE marks-only applied");
  const body = () => fields({ classBand: template.classBand, board: t.board, scaleId: t.scaleId, coScaleId: t.coScaleId, termSplit: t.termSplit, ...(t.showGrade ? { showGrade: "true" } : {}), ...(t.showRank ? { showRank: "true" } : {}) });
  return (
    <Panel title={`Classes ${template.classBand}`} action={template.saved ? <ToneBadge label="Saved" tone="success" /> : <ToneBadge label="Using defaults" />}>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={LBL}>Board
          <select className={INPUT} value={t.board} disabled={!canEdit} onChange={(e) => setT({ ...t, board: e.target.value })}>
            <option value="cbse">CBSE</option><option value="icse">ICSE</option><option value="state">State board</option>
          </select>
        </label>
        <label className={LBL}>Grade scale
          <select className={INPUT} value={t.scaleId} disabled={!canEdit} onChange={(e) => setT({ ...t, scaleId: e.target.value })}>
            <option value="">School default</option>{scales.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className={LBL}>Co-scholastic scale
          <select className={INPUT} value={t.coScaleId} disabled={!canEdit} onChange={(e) => setT({ ...t, coScaleId: e.target.value })}>
            <option value="">School default</option>{coScales.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={t.showGrade} disabled={!canEdit} onChange={(e) => setT({ ...t, showGrade: e.target.checked })} className="h-4 w-4 accent-[var(--ds-primary)]" />Show grades</label>
        <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={t.showRank} disabled={!canEdit} onChange={(e) => setT({ ...t, showRank: e.target.checked })} className="h-4 w-4 accent-[var(--ds-primary)]" />Show rank</label>
        <label className={`${LBL} w-48`}>Final split by term (%)<input className={INPUT} value={t.termSplit} placeholder="Blank = average" disabled={!canEdit} onChange={(e) => setT({ ...t, termSplit: e.target.value })} /></label>
      </div>
      <Err text={errors.termSplit ?? errors.scaleId ?? errors.coScaleId} />
      {canEdit ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" className="rounded-full" isLoading={pending} onClick={() => run(body())}>Save</Button>
          <Button type="button" variant="secondary" className="rounded-full" isLoading={preset.pending} onClick={() => preset.run(fields({ preset: "icse_marks_only", classBand: template.classBand }))}>Use ICSE marks-only</Button>
        </div>
      ) : null}
    </Panel>
  );
}

// ---------- term weights ----------

export function WeightsEditor({ termId, exams, action, canEdit }: { termId: string; exams: { id: string; name: string; weight: number }[]; action: Action; canEdit: boolean }) {
  const [w, setW] = useState<Record<string, string>>(Object.fromEntries(exams.map((e) => [e.id, String(e.weight)])));
  const { pending, errors, run } = useSave(action, "Weights saved");
  const total = exams.reduce((n, e) => n + (Number(w[e.id]) || 0), 0);
  return (
    <div className="flex flex-col gap-2">
      {exams.map((e) => (
        <label key={e.id} className="grid grid-cols-[1fr_6rem] items-center gap-3 rounded-2xl bg-white/[0.03] px-3 py-2 text-sm">
          <span className="min-w-0 truncate">{e.name}</span>
          <span className="flex items-center gap-1"><input aria-label={`Weight of ${e.name} in percent`} className={`${INPUT} text-right tabular-nums`} type="number" inputMode="numeric" min={0} max={100} value={w[e.id]} disabled={!canEdit} onChange={(ev) => setW({ ...w, [e.id]: ev.target.value })} />%</span>
        </label>
      ))}
      <p className={`text-sm tabular-nums ${total === 100 ? "text-[var(--ds-on-surface-variant)]" : "text-[var(--ds-color-danger-400)]"}`} aria-live="polite">Total {total} of 100</p>
      <Err text={errors.weights} />
      {canEdit ? <div><Button type="button" className="rounded-full" isLoading={pending} disabled={total !== 100} onClick={() => run(fields({ termId, weights: JSON.stringify(exams.map((e) => ({ examId: e.id, weightPercent: Number(w[e.id]) || 0 }))) }))}>Save weights</Button></div> : null}
    </div>
  );
}

// ---------- paper components ----------

export function ComponentsEditor({ paperId, components, action }: { paperId: string; components: { name: string; maxMarks: number }[]; action: Action }) {
  const [rows, setRows] = useState(components.map((c) => ({ name: c.name, maxMarks: String(c.maxMarks) })));
  const { pending, errors, run } = useSave(action, "Parts saved");
  const total = rows.reduce((n, r) => n + (Number(r.maxMarks) || 0), 0);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Panel title="Parts of this paper" className="mb-3">
      <p className="mb-3 text-sm text-[var(--ds-on-surface-variant)]">Split the paper into parts such as Theory and Internal. Each part is entered on its own and the paper total is their sum. Leave empty for a single mark.</p>
      <label className={`${LBL} mb-3 max-w-sm`}>Start from a preset
        <select className={INPUT} value="" onChange={(e) => { const p = COMPONENT_PRESETS[e.target.value]; if (p) setRows(p.map((c) => ({ name: c.name, maxMarks: String(c.maxMarks) }))); }}>
          <option value="">Choose a preset</option>{Object.keys(COMPONENT_PRESETS).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_6rem_auto] items-end gap-2">
            <label className={LBL}>Part<input className={INPUT} value={r.name} maxLength={40} onChange={(e) => set(i, { name: e.target.value })} /></label>
            <label className={LBL}>Out of<input className={INPUT} type="number" inputMode="numeric" min={1} value={r.maxMarks} onChange={(e) => set(i, { maxMarks: e.target.value })} /></label>
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${r.name}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Remove</Button>
          </div>
        ))}
      </div>
      <Err text={errors.components} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" className="rounded-full" onClick={() => setRows((r) => [...r, { name: "", maxMarks: "10" }])}>Add part</Button>
        <Button type="button" className="rounded-full" isLoading={pending} disabled={rows.some((r) => !r.name.trim() || !(Number(r.maxMarks) >= 1))}
          onClick={() => run(fields({ paperId, components: JSON.stringify(rows.map((r) => ({ name: r.name.trim(), maxMarks: Number(r.maxMarks) }))) }))}>Save parts</Button>
        <span className="text-sm tabular-nums text-[var(--ds-on-surface-variant)]">{rows.length ? `Paper total ${total}` : "One mark per student"}</span>
      </div>
    </Panel>
  );
}
