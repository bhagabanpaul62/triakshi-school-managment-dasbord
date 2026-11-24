"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { Money } from "@smw/ui/finance/Money";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";

type Action = (fd: FormData) => Promise<FormResult>;
interface Preview {
  columns: string[]; guess: Record<string, string | undefined>; mapping: Record<string, string | undefined> | null; sample: Record<string, string>[];
  ready: boolean; total: number; fresh: number; duplicates: number; errorCount: number; errors: { line: number; message: string }[];
  from: string | null; to: string | null; inPaise: number; outPaise: number;
}
interface Done { imported: number; duplicates: number; autoMatched: number }

const FIELDS = [["dateCol", "Date", "date", true], ["descriptionCol", "Words (narration)", "description", false], ["referenceCol", "Reference or cheque number", "reference", false], ["amountCol", "One amount column (money out is minus)", "amount", false], ["debitCol", "Money out (debit or withdrawal)", "debit", false], ["creditCol", "Money in (credit or deposit)", "credit", false]] as const;

/** Step 1: choose the file and see how its columns were read. Step 2: check nothing is wrong. Step 3: import. Nothing is saved before the last press. */
export function BankImportForm({ cashAccountId, check, commit, doneHref }: { cashAccountId: string; check: Action; commit: Action; doneHref: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [map, setMap] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = (action: Action, then: (r: FormResult) => void, mapping: Record<string, string>) => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file); fd.set("cashAccountId", cashAccountId);
    for (const [k, v] of Object.entries(mapping)) if (v) fd.set(k, v);
    start(async () => then(await action(fd)));
  };
  const runCheck = (mapping: Record<string, string>) => send(check, (r) => {
    if (r.ok) {
      const p = r.data as Preview;
      setPreview(p); setError(null);
      if (!Object.keys(mapping).length) setMap({ dateCol: p.guess.date ?? "", descriptionCol: p.guess.description ?? "", referenceCol: p.guess.reference ?? "", amountCol: p.guess.amount ?? "", debitCol: p.guess.debit ?? "", creditCol: p.guess.credit ?? "" });
    } else { setPreview(null); setError(r.fieldErrors?.file ?? r.error); }
  }, mapping);
  const runImport = () => send(commit, (r) => {
    if (r.ok) { setDone(r.data as Done); toast(`${(r.data as Done).imported} lines imported`); } else { setError(r.fieldErrors?.file ?? r.error); toast(r.error, "danger"); }
  }, map);

  if (done) {
    return (
      <Panel title={done.imported ? `${done.imported} lines imported` : "Nothing new in this file"}>
        <p className="text-sm text-[var(--ds-on-surface-variant)]">{done.autoMatched} matched at once. {done.duplicates ? `${done.duplicates} were already here and were skipped.` : ""}</p>
        <Link href={doneHref} className="mt-4 inline-flex h-10 items-center rounded-full bg-[var(--ds-primary)] px-5 text-sm font-medium text-[var(--ds-on-primary)]">{done.imported ? "Match the rest" : "Back to the statement"}</Link>
      </Panel>
    );
  }
  const setCol = (k: string, v: string) => setMap((m) => ({ ...m, [k]: v }));
  return (
    <div className="flex flex-col gap-3">
      <Panel title="1. Choose the statement">
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".xlsx,.csv,text/csv" aria-label="Bank statement file" className={`${INPUT} max-w-sm py-2 file:mr-3 file:rounded-full file:border-0 file:bg-white/[0.08] file:px-3 file:text-[var(--ds-on-surface)]`}
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setError(null); setMap({}); }} />
          <Button type="button" className="rounded-full" disabled={!file} isLoading={pending && !preview} onClick={() => runCheck({})}>Check the file</Button>
        </div>
        <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">The first row must be the column names. Dates like 05-11-2026, 05/11/2026 or 2026-11-05. Importing a file twice, or two files that overlap, never doubles a line.</p>
        {error ? <p role="alert" className="mt-3 text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
      </Panel>

      {preview ? (
        <>
          <Panel title="2. Which column is which">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {FIELDS.map(([key, label, , required]) => (
                <label key={key} className="flex flex-col gap-1.5 text-[13px] text-[var(--ds-on-surface-variant)]">{label}{required ? " *" : ""}
                  <select value={map[key] ?? ""} onChange={(e) => setCol(key, e.target.value)} className={INPUT}>
                    <option value="">{required ? "Choose a column" : "None"}</option>
                    {preview.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">Use either the one amount column, or the money out and money in columns.</p>
            <div className="mt-4"><Button type="button" variant="secondary" className="rounded-full" isLoading={pending} onClick={() => runCheck(map)}>Check again</Button></div>
          </Panel>

          <Panel title="3. Review" action={<Button type="button" className="rounded-full" disabled={!preview.ready || preview.fresh === 0} isLoading={pending} onClick={runImport}>{preview.fresh ? `Import ${preview.fresh} lines` : "Nothing new to import"}</Button>}>
            {!preview.mapping ? <p className="text-sm">Choose the date column and the amount column or columns above, then check again.</p> : (
              <div className="flex flex-col gap-3 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="tabular-nums">{preview.total} lines{preview.from ? `, ${preview.from} to ${preview.to}` : ""}</span>
                  <ToneBadge label={`${preview.fresh} new`} tone="success" />
                  {preview.duplicates ? <ToneBadge label={`${preview.duplicates} already here`} tone="default" /> : null}
                  {preview.errorCount ? <ToneBadge label={`${preview.errorCount} with problems`} tone="danger" /> : null}
                </div>
                <p className="text-xs text-[var(--ds-on-surface-muted)]">Money in <Money paise={preview.inPaise} size="sm" /> · money out <Money paise={preview.outPaise} size="sm" />. Compare these with the totals on the bank's statement.</p>
                {preview.errors.length ? (
                  <ul className="flex flex-col gap-1">{preview.errors.map((e) => <li key={e.line} className="text-[var(--ds-color-danger-400)]"><span className="font-mono text-xs">Line {e.line}</span>: {e.message}</li>)}</ul>
                ) : <p>Every line can be read. Nothing is saved until you press Import.</p>}
                {preview.errorCount ? <p className="text-xs text-[var(--ds-on-surface-muted)]">Line numbers match your file (line 1 is the header). The import is all or nothing: fix the file and choose it again.</p> : null}
              </div>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}
