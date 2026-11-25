"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";
import type { ImportReport } from "../enquiry-import-service";

type Action = (fd: FormData) => Promise<FormResult & { data?: unknown }>;

/** Step 1 choose a file and check it (nothing is saved), step 2 import it. Problems are listed by row, with the line of the file. */
export function EnquiryImportForm({ check, commit }: { check: Action; commit: Action }) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [done, setDone] = useState<{ imported: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const post = (action: Action, then: (r: FormResult & { data?: unknown }) => void) => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    start(async () => { then(await action(fd)); });
  };
  const runCheck = () => post(check, (r) => { if (r.ok) { setReport(r.data as ImportReport); setError(null); setDone(null); } else { setReport(null); setError(r.fieldErrors?.file ?? r.error); } });
  const runImport = () => post(commit, (r) => {
    if (r.ok) { setDone(r.data as { imported: number; skipped: number }); setReport(null); setFile(null); if (input.current) input.current.value = ""; toast("Enquiries imported"); router.refresh(); }
    else { setError(r.fieldErrors?.file ?? r.error); toast(r.error, "danger"); }
  });
  const problems = report?.rows.filter((r) => r.errors.length || r.duplicateOf) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <Panel title="1. Choose a file">
        <div className="flex flex-wrap items-center gap-3">
          <input ref={input} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Excel or CSV file" className={`${INPUT} max-w-sm py-2 file:mr-3 file:rounded-full file:border-0 file:bg-white/[0.08] file:px-3 file:text-[var(--ds-on-surface)]`}
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); setError(null); }} />
          <Button type="button" className="rounded-full" onClick={runCheck} disabled={!file} isLoading={pending && !report}>Check file</Button>
        </div>
        {error ? <p role="alert" className="mt-3 text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
      </Panel>
      {done ? (
        <Panel title="Imported">
          <p className="text-sm">{done.imported} enquiries were added{done.skipped ? `, and ${done.skipped} that were already there were left out` : ""}. Each has a call to make tomorrow morning.</p>
          <div className="mt-3"><Button asChild variant="secondary" className="rounded-full"><Link href="/app/enquiries?view=list">See the list</Link></Button></div>
        </Panel>
      ) : null}
      {report ? (
        <Panel title="2. Review" action={<Button type="button" className="rounded-full" onClick={runImport} disabled={report.failed > 0 || report.ready === 0} isLoading={pending}>Import {report.ready} enquiries</Button>}>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="tabular-nums">{report.total} rows</span>
            <ToneBadge label={`${report.ready} ready`} tone="success" />
            {report.duplicates ? <ToneBadge label={`${report.duplicates} already known, left out`} tone="warning" /> : null}
            {report.failed ? <ToneBadge label={`${report.failed} with problems`} tone="danger" /> : null}
          </div>
          {report.failed ? <p className="mb-3 text-sm text-[var(--ds-on-surface-variant)]">Nothing is imported while any row has a problem. Fix the file and check it again.</p> : null}
          {problems.length === 0 ? <WidgetEmptyState title="Every row looks good." description="Nothing is saved until you press Import." /> : (
            <div className="custom-scrollbar -mx-2 relative overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead><tr className="text-left font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]"><th className="px-2 pb-2 font-normal">Line</th><th className="px-2 pb-2 font-normal">Child</th><th className="px-2 pb-2 font-normal">Problem</th></tr></thead>
                <tbody>{problems.map((r) => (
                  <tr key={r.line} className="align-top"><td className="px-2 py-1.5 tabular-nums">{r.line}</td><td className="px-2 py-1.5">{r.child ?? "-"}</td>
                    <td className="px-2 py-1.5 text-[var(--ds-on-surface-variant)]">{r.errors.length ? r.errors.join("; ") : `Already in ${r.duplicateOf}`}</td></tr>))}</tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
