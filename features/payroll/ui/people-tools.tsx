"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { Modal, ModalFooter } from "@smw/ui/kit/Modal";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { paise } from "@smw/ui/format";

type Run = (fd: FormData) => Promise<FormResult>;
interface Raise { rows: { userId: string; name: string; oldPaise: number; newPaise: number }[]; skipped: { name: string; why: string }[] }
interface Sheet { rows: { line: number; employeeId: string; ok: boolean; error?: string }[]; ok: number; failed: number }

const Row = ({ label, children }: { label: string; children: ReactNode }) => <label className="flex flex-col gap-1.5 text-sm"><span className="text-[var(--ds-on-surface-variant)]">{label}</span>{children}</label>;

/** A raise for many people by a percent: shows who gets what first, then saves. */
export function RaiseTool({ preview, commit, departments, today }: { preview: Run; commit: Run; departments: string[]; today: string }) {
  const [open, setOpen] = useState(false), [data, setData] = useState<Raise | null>(null), [pending, start] = useTransition();
  const router = useRouter();
  const [form, setForm] = useState<FormData | null>(null);
  const check = (fd: FormData) => start(async () => { const r = await preview(fd); if (r.ok) { setData(r.data as Raise); setForm(fd); } else toast(r.error, "danger"); });
  const save = () => start(async () => { const r = await commit(form!); if (r.ok) { toast(r.message ?? "Saved"); setOpen(false); setData(null); router.refresh(); } else toast(r.error, "danger"); });
  return (
    <>
      <Button type="button" variant="secondary" className="rounded-full" onClick={() => setOpen(true)}>Raise pay for many</Button>
      <Modal open={open} onOpenChange={setOpen} size="lg" title="Raise pay for many" description="Each person keeps their structure. The new amount is rounded to a whole rupee."
        footer={<ModalFooter secondary={{ onClick: () => setOpen(false) }} primary={data ? { label: `Save the raise for ${data.rows.length} people`, onClick: save, loading: pending, disabled: !data.rows.length } : { label: "Show who gets what", type: "submit", form: "raise-form", loading: pending }} />}>
        <form id="raise-form" onSubmit={(e) => { e.preventDefault(); check(new FormData(e.currentTarget)); }} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Row label="Raise by percent"><input name="percent" type="number" step="0.1" min="0.1" required className={INPUT} placeholder="8" onChange={() => setData(null)} /></Row>
          <Row label="From"><input name="fromDate" type="date" required min={today} defaultValue={today} className={INPUT} onChange={() => setData(null)} /></Row>
          <Row label="Only this department"><select name="department" className={INPUT} onChange={() => setData(null)}><option value="">Everyone</option>{departments.map((d) => <option key={d}>{d}</option>)}</select></Row>
        </form>
        {data ? (
          <div className="mt-5 text-sm">
            <ul className="flex max-h-72 flex-col gap-1 overflow-auto">{data.rows.map((r) => <li key={r.userId} className="flex justify-between gap-3"><span>{r.name}</span><span className="tabular-nums text-[var(--ds-on-surface-variant)]">{paise(r.oldPaise)} to {paise(r.newPaise)}</span></li>)}</ul>
            {data.skipped.length ? <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">Left out: {data.skipped.map((s) => `${s.name} (${s.why.toLowerCase()})`).join(", ")}.</p> : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}

/** Upload a sheet of pay (employee_id, structure, gross, from_date): check it first; nothing is saved unless every row is right. */
export function ImportTool({ check, commit }: { check: Run; commit: Run }) {
  const [open, setOpen] = useState(false), [report, setReport] = useState<Sheet | null>(null), [file, setFile] = useState<File | null>(null), [pending, start] = useTransition();
  const router = useRouter();
  const send = (action: Run, then: (r: FormResult) => void) => start(async () => { const fd = new FormData(); fd.set("file", file!); then(await action(fd)); });
  return (
    <>
      <Button type="button" variant="ghost" className="rounded-full" onClick={() => setOpen(true)}>Import pay from a sheet</Button>
      <Modal open={open} onOpenChange={setOpen} size="lg" title="Import pay from a sheet" description="Columns: employee_id, structure, gross (rupees), from_date (like 2026-12-01), hourly_rate (optional). A .csv or .xlsx file."
        footer={<ModalFooter secondary={{ onClick: () => setOpen(false) }} primary={report && !report.failed && report.ok ? { label: `Save ${report.ok} rows`, loading: pending, onClick: () => send(commit, (r) => { if (r.ok) { toast("Pay imported"); setOpen(false); setReport(null); router.refresh(); } else toast(r.error, "danger"); }) } : { label: "Check the file", loading: pending, disabled: !file, onClick: () => send(check, (r) => { if (r.ok) setReport(r.data as Sheet); else toast(r.error, "danger"); }) }} />}>
        <input type="file" accept=".csv,.xlsx" aria-label="Pay sheet" className={INPUT} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }} />
        {report ? (
          <div className="mt-4 text-sm"><p>{report.ok} rows are right{report.failed ? `, ${report.failed} need fixing. Nothing is saved until every row is right.` : "."}</p>
            <ul className="mt-2 flex max-h-60 flex-col gap-1 overflow-auto text-[var(--ds-color-danger-300)]">{report.rows.filter((r) => !r.ok).map((r) => <li key={r.line}>Line {r.line} ({r.employeeId || "no ID"}): {r.error}</li>)}</ul></div>
        ) : null}
      </Modal>
    </>
  );
}
