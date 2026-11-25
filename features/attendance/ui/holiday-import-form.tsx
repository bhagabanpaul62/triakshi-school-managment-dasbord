"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { Button } from "@smw/ui/ui/button";
import type { ImportReport } from "../holiday-import";

type Action = (fd: FormData) => Promise<FormResult>;

/** Choose a sheet and check it (nothing is saved), then add every row at once. One bad row and nothing is added. */
export function HolidayImportForm({ check, commit, template }: { check: Action; commit: Action; template: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const post = (action: Action, then: (r: FormResult) => void) => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    start(async () => then(await action(fd)));
  };
  const runCheck = () => post(check, (r) => {
    if (r.ok) { setReport(r.data as ImportReport); setError(null); } else { setReport(null); setError(r.fieldErrors?.file ?? r.error); }
  });
  const runImport = () => post(commit, (r) => {
    if (r.ok) { toast(`${(r.data as { imported: number }).imported} holidays added`); setFile(null); setReport(null); router.refresh(); }
    else { setError(r.fieldErrors?.file ?? r.error); toast(r.error, "danger"); }
  });

  const problems = report?.rows.filter((r) => r.errors.length) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--ds-on-surface-variant)]">
        One row per holiday or break (.xlsx or .csv). Columns: <span className="font-mono text-xs">date</span> (or <span className="font-mono text-xs">from</span> and <span className="font-mono text-xs">to</span>),{" "}
        <span className="font-mono text-xs">name</span>, <span className="font-mono text-xs">kind</span> (optional). Dates are DD-MM-YYYY or YYYY-MM-DD.{" "}
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`} download="holidays-template.csv" className="underline underline-offset-2 hover:text-[var(--ds-on-surface)]">Download a template</a>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" accept=".xlsx,.csv,text/csv" aria-label="Spreadsheet file" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); setError(null); }}
          className={`${INPUT} max-w-full py-2 sm:max-w-sm file:mr-3 file:rounded-full file:border-0 file:bg-white/[0.08] file:px-3 file:text-[var(--ds-on-surface)]`} />
        <Button type="button" variant="secondary" className="rounded-full" onClick={runCheck} disabled={!file} isLoading={pending && !report}>Check file</Button>
      </div>
      {error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
      {report ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="tabular-nums">{report.total} rows</span>
            <ToneBadge label={`${report.valid} ready`} tone="success" />
            {report.failed ? <ToneBadge label={`${report.failed} with problems`} tone="danger" /> : null}
          </div>
          {problems.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {problems.map((r) => (
                <li key={r.line} className="rounded-2xl bg-white/[0.04] px-3 py-2">
                  <span className="tabular-nums text-[var(--ds-on-surface-muted)]">Line {r.line}</span> {r.name || "(no name)"}
                  {r.errors.map((e) => <span key={e.column} className="block text-[var(--ds-color-danger-400)]"><span className="font-mono text-xs">{e.column}</span>: {e.message}</span>)}
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-[var(--ds-on-surface-variant)]">Every row looks good. Nothing is saved until you press Add.</p>}
          <div><Button type="button" className="rounded-full" onClick={runImport} disabled={report.failed > 0 || report.valid === 0} isLoading={pending}>Add {report.valid} holidays</Button></div>
        </div>
      ) : null}
    </div>
  );
}
