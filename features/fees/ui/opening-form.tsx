"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { INPUT } from "@smw/ui/shell/FormModal";
import { Money } from "@smw/ui/finance/Money";
import { importOpening } from "./actions";
import { CARD, H3, LINK, MUTED } from "./styles";

interface Result { applied: boolean; submitted?: boolean; errors: { line: number; message: string }[]; totals: { students: number; duesPaise: number; advancePaise: number; depositPaise: number } }

/** Check the sheet first (nothing is written), fix the lines it names, then import. One bad line stops the whole import. */
export function OpeningForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const run = (dry: boolean) => start(async () => {
    if (!file) { setError("Choose the filled sheet first."); return; }
    setError("");
    const fd = new FormData(); fd.set("file", file); fd.set("dry", dry ? "1" : "0");
    const r = await importOpening(fd);
    if (!r.ok) { setError(r.error); return; }
    setResult(r.data as Result); setChecked(dry && (r.data as Result).errors.length === 0); if (!dry) { setChecked(false); router.refresh(); }
  });

  return (
    <div className="flex flex-col gap-5">
      <section className={`${CARD} flex flex-col gap-4`}>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
          <li><a href="/app/fees/opening/template" className={LINK}>Download the sheet</a>. One row per student: admission number, dues, advance, deposit, as of date. Amounts in rupees.</li>
          <li>Fill it from the old system and choose it below.</li>
          <li>Check it. Nothing is saved yet. Fix any line it names, then check again.</li>
          <li>Send it for approval. Nothing is posted until an approver says yes, then dues become one issued bill per student and advance and deposit go on their lists.</li>
        </ol>
        <label className="flex max-w-md flex-col gap-1.5 text-sm">The filled sheet (CSV or Excel)
          <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); setChecked(false); setError(""); }} className={`${INPUT} py-2`} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" className="rounded-full" isLoading={pending} disabled={!file} onClick={() => run(true)}>Check the sheet</Button>
          <Button type="button" className="rounded-full" isLoading={pending} disabled={!checked} onClick={() => run(false)}>Send for approval</Button>
          {!checked && file && !result ? <span className={MUTED}>Check the sheet before sending it.</span> : null}
        </div>
        {error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
      </section>

      {result ? (
        <section className={CARD} aria-live="polite">
          {result.errors.length ? (
            <>
              <h2 className={H3}>{result.errors.length} line{result.errors.length === 1 ? "" : "s"} to fix. Nothing was imported.</h2>
              <ul className="divide-y divide-white/[0.06] text-sm">{result.errors.slice(0, 100).map((e, i) => <li key={i} className="flex gap-3 py-2"><span className="w-16 shrink-0 tabular-nums text-[var(--ds-on-surface-muted)]">Line {e.line}</span><span className="text-[var(--ds-color-danger-400)]">{e.message}</span></li>)}</ul>
              {result.errors.length > 100 ? <p className={`${MUTED} mt-2`}>And {result.errors.length - 100} more. Fix these and check again.</p> : null}
            </>
          ) : (
            <>
              <h2 className="text-lg font-medium">{result.submitted ? "Sent for approval" : "The sheet is clean"}</h2>
              <dl className="mt-3 flex flex-wrap gap-x-10 gap-y-3">
                <div><dt className={MUTED}>Students</dt><dd className="text-xl tabular-nums">{result.totals.students}</dd></div>
                <div><dt className={MUTED}>Dues</dt><dd><Money paise={result.totals.duesPaise} size="lg" /></dd></div>
                <div><dt className={MUTED}>Advance</dt><dd><Money paise={result.totals.advancePaise} size="lg" /></dd></div>
                <div><dt className={MUTED}>Deposit</dt><dd><Money paise={result.totals.depositPaise} size="lg" /></dd></div>
              </dl>
              <p className={`${MUTED} mt-3`}>{result.submitted ? <>It waits for an approver below. Once approved, <Link href="/app/fees/invoices?kind=opening" className={LINK}>the opening bills</Link> and <Link href="/app/fees/dues" className={LINK}>the dues</Link> show it.</> : "Press Send for approval. It posts to the books against Opening balances only after an approver says yes."}</p>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
