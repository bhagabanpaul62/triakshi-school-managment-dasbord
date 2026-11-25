"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ImportReport, ImportResult } from "@smw/feature-staff/import";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { Button } from "@smw/ui/ui/button";
import { checkStaffSheet, importStaffSheet } from "./actions";

const EXAMPLE = "name\temail\tphone\trole\nPriya Sharma\tpriya@school.in\t9876543210\tTeacher\nRamesh Kumar\tramesh@school.in\t\tAccountant";
const SHOWN = 6;

/** Staff from a sheet: paste the cells you copied, or choose a file. The first row names the columns. Checked first, saved only when every row passes. */
export function StaffSheet({ existing }: { existing: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const form = () => { const fd = new FormData(); if (file) fd.set("file", file); else fd.set("text", text); return fd; };
  const post = (action: (fd: FormData) => Promise<FormResult>, then: (r: Extract<FormResult, { ok: true }>) => void) =>
    start(async () => {
      const r = await action(form());
      if (r.ok) { setError(null); then(r); } else { setReport(null); setError(r.fieldErrors?.file ?? r.error); toast(r.error, "danger"); }
    });
  const reset = () => { setReport(null); setError(null); };
  const hasInput = !!file || !!text.trim();
  const problems = report?.rows.filter((r) => r.errors.length) ?? [];
  const links = result?.people.filter((p) => p.accessLink) ?? [];

  if (result) {
    return (
      <div className="rounded-2xl bg-white/[0.04] p-4 text-sm">
        <p className="font-medium text-[var(--ds-on-surface)]">{result.imported} {result.imported === 1 ? "person" : "people"} added</p>
        <p className="mt-1 text-[var(--ds-on-surface-muted)]">{links.length ? `${links.length} have no email. Share their link yourself; each works once for 7 days and is shown only here.` : "Everyone has an email, so every invite was sent."}</p>
        {links.length ? (
          <ul className="mt-3 flex flex-col gap-2">
            {links.map((p) => (
              <li key={p.accessLink} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-[var(--ds-on-surface)]">{p.name}</span>
                <button type="button" onClick={() => navigator.clipboard.writeText(p.accessLink!).then(() => toast("Copied"), () => toast("Could not copy. Select the link and copy it.", "danger"))}
                  className="min-h-10 shrink-0 px-2 text-[var(--ds-primary-text)] hover:underline">Copy link</button>
              </li>
            ))}
          </ul>
        ) : null}
        <Button type="button" className="mt-4 rounded-full" onClick={() => router.refresh()}>Continue</Button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white/[0.04] p-4">
      <label htmlFor="staff-paste" className="text-sm font-medium text-[var(--ds-on-surface)]">Paste from a sheet</label>
      <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">Copy the cells in Excel or Google Sheets, with the header row (name, email, phone, role), and paste here. Role is Teacher, Accountant or Admin.</p>
      <textarea id="staff-paste" rows={5} value={text} placeholder={EXAMPLE} disabled={!!file} onChange={(e) => { setText(e.target.value); reset(); }} aria-invalid={!!error} className={`${INPUT} mt-2 font-mono text-xs`} />
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <label htmlFor="staff-file" className="text-[var(--ds-on-surface-variant)]">or upload a file</label>
        <input id="staff-file" type="file" accept=".csv,.xlsx,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }}
          className={`${INPUT} max-w-xs py-2 file:mr-3 file:rounded-full file:border-0 file:bg-white/[0.08] file:px-3 file:text-[var(--ds-on-surface)]`} />
        <a href="/app/staff/import/template" download className="text-[var(--ds-primary-text)] hover:underline">Template</a>
      </div>
      {existing > 0 ? <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">You already have {existing} {existing === 1 ? "teacher" : "teachers"}. People in the sheet are added to them.</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-[var(--ds-color-danger-300)]">{error}</p> : null}
      {report ? (
        <div className="mt-3 text-sm">
          <p className="text-[var(--ds-on-surface)]">{report.valid} of {report.total} rows are ready{report.failed ? `, ${report.failed} need a fix` : ""}.</p>
          {problems.length ? (
            <ul className="mt-2 flex flex-col gap-1.5 text-[var(--ds-on-surface-muted)]">
              {problems.slice(0, SHOWN).map((r) => <li key={r.line}>Line {r.line}{r.name ? `, ${r.name}` : ""}: {r.errors.map((e) => `${e.column} ${e.message}`).join(". ")}</li>)}
              {problems.length > SHOWN ? <li>and {problems.length - SHOWN} more rows</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <Button type="button" variant="secondary" className="rounded-full" disabled={pending || !hasInput} onClick={() => post(checkStaffSheet, (r) => setReport(r.data as ImportReport))}>Check the sheet</Button>
        {report && !report.failed && report.valid > 0 ? (
          <Button type="button" className="rounded-full" disabled={pending} isLoading={pending} onClick={() => post(importStaffSheet, (r) => { setResult(r.data as ImportResult); toast(r.message ?? "Staff added"); })}>Add {report.valid} {report.valid === 1 ? "person" : "people"}</Button>
        ) : null}
      </div>
    </div>
  );
}
