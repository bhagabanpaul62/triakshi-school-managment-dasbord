"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";
import type { ImportReport } from "../import-service";

type Imported = { imported: number; slipClasses: { id: string; name: string }[] };
type Action = (fd: FormData) => Promise<FormResult & { data?: unknown }>;

/** Step 1 choose an Excel or CSV file and check it (nothing is written), step 2 import it. Errors are listed by row. */
export function ImportForm({ check, commit }: { check: Action; commit: Action }) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [done, setDone] = useState<Imported | null>(null);
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

  const runCheck = () => post(check, (r) => {
    if (r.ok) { setReport(r.data as ImportReport); setError(null); }
    else { setReport(null); setError(r.fieldErrors?.file ?? r.error); }
  });
  const runImport = () => post(commit, (r) => {
    if (r.ok) { const d = r.data as Imported; toast(`${d.imported} students imported`); setDone(d); setReport(null); setFile(null); router.refresh(); }
    else { setError(r.fieldErrors?.file ?? r.error); toast(r.error, "danger"); }
  });

  const problems = report?.rows.filter((r) => r.errors.length) ?? [];

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
          <p className="text-sm">{done.imported} students were admitted. Their first sign-in is the date of birth as DDMMYYYY, or the admission number.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {done.slipClasses.map((c) => <Button key={c.id} asChild variant="secondary" className="rounded-full"><Link href={`/app/students/credentials?classId=${c.id}`}>Login slips: {c.name}</Link></Button>)}
            <Button asChild variant="secondary" className="rounded-full"><Link href="/app/students">Back to students</Link></Button>
          </div>
        </Panel>
      ) : null}

      {report ? (
        <Panel title="2. Review"
          action={<Button type="button" className="rounded-full" onClick={runImport} disabled={report.failed > 0 || report.valid === 0 || !!report.limitMessage} isLoading={pending}>
            Import {report.valid} students
          </Button>}>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="tabular-nums">{report.total} rows</span>
            <ToneBadge label={`${report.valid} ready`} tone="success" />
            {report.failed ? <ToneBadge label={`${report.failed} with problems`} tone="danger" /> : null}
            {report.limitMessage ? <ToneBadge label={report.limitMessage} tone="warning" /> : null}
          </div>
          {problems.length === 0 ? (
            <WidgetEmptyState title="Every row looks good." description="Nothing is saved until you press Import." />
          ) : (
            <div className="custom-scrollbar -mx-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">
                    <th scope="col" className="px-2 pb-2 font-normal">Row</th>
                    <th scope="col" className="px-2 pb-2 font-normal">Student</th>
                    <th scope="col" className="px-2 pb-2 font-normal">What to fix</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.map((r) => (
                    <tr key={r.line} className="align-top transition-colors hover:bg-white/[0.04]">
                      <td className="px-2 py-2 tabular-nums text-[var(--ds-on-surface-muted)]">{r.line}</td>
                      <td className="px-2 py-2">{r.name ?? "-"}{r.admissionNo ? <span className="block text-xs text-[var(--ds-on-surface-muted)]">{r.admissionNo}</span> : null}</td>
                      <td className="px-2 py-2"><ul className="flex flex-col gap-1">{r.errors.map((e) => <li key={e} className="text-[var(--ds-color-danger-400)]">{e}</li>)}</ul></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 text-xs text-[var(--ds-on-surface-muted)]">Row numbers match the lines in your file (line 1 is the header). The import is all or nothing.</p>
        </Panel>
      ) : null}
    </div>
  );
}
