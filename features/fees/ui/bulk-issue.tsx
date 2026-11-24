"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@smw/ui/ui/button";
import { INPUT } from "@smw/ui/shell/FormModal";
import { Money } from "@smw/ui/finance/Money";
import { EmptyLine } from "@smw/ui/finance/States";
import { issueFromPlans, previewIssue } from "./actions";
import { csvCell } from "./collect/logic";
import { CARD, H3, LINK, MUTED } from "./styles";

interface Row { studentId: string; studentName: string; admissionNo: string; label: string; dueOn: string; grossPaise: number; concessionPaise: number; duePaise: number }
interface Exception { studentId: string; studentName: string; admissionNo: string; reason: "no_plan" | "left" | "already_billed" | "opted_out"; detail: string; href: string; fix: string }
interface Preview { yearId: string; count: number; grossPaise: number; concessionPaise: number; skipped: { alreadyIssued: number; noPlan: number; left: number }; rows: Row[]; exceptions: Exception[] }
const REASON: Record<Exception["reason"], string> = { no_plan: "No fee plan", left: "Left the school", already_billed: "Already billed", opted_out: "Optional fee not taken" };

/** Every student the bills pass over, with why and the link that fixes it. Filter by reason, download the list. */
function Exceptions({ list }: { list: Exception[] }) {
  const [reason, setReason] = useState<"" | Exception["reason"]>("");
  const shown = reason ? list.filter((e) => e.reason === reason) : list;
  const kinds = (Object.keys(REASON) as Exception["reason"][]).filter((k) => list.some((e) => e.reason === k));
  const csv = () => {
    const body = [["Student", "Admission no", "Why", "Detail", "Fix at"], ...shown.map((e) => [e.studentName, e.admissionNo, REASON[e.reason], e.detail, e.href])].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`\uFEFF${body}`], { type: "text/csv;charset=utf-8" })); a.download = "students-left-out.csv"; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={H3}>Left out ({list.length})</h3>
        <button type="button" onClick={csv} className="text-sm underline underline-offset-4">Download CSV</button>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by reason">
        {([["", "All"], ...kinds.map((k) => [k, REASON[k]])] as [string, string][]).map(([k, label]) => <button key={k} type="button" aria-pressed={reason === k} onClick={() => setReason(k as typeof reason)} className={`rounded-full px-3 py-1.5 text-sm ${reason === k ? "bg-white/[0.16]" : "bg-white/[0.05]"}`}>{label}{k ? ` (${list.filter((e) => e.reason === k).length})` : ""}</button>)}
      </div>
      <ul className="custom-scrollbar max-h-80 divide-y divide-white/[0.06] overflow-y-auto">
        {shown.map((e, i) => <li key={`${e.studentId}${e.reason}${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className="min-w-0"><Link href={`/app/fees/students/${e.studentId}`} className={LINK}>{e.studentName}</Link> <span className={MUTED}>{e.admissionNo} · {REASON[e.reason]}</span><span className={`${MUTED} block`}>{e.detail}</span></span><Link href={e.href} className={LINK}>{e.fix}</Link></li>)}
      </ul>
    </div>
  );
}
const CHUNK = 100, SHOWN = 50;

/** Issue the bills the published plans call for: choose, look at exactly what will be made, then issue in steps with a count. */
export function BulkIssue({ years, classes, dueKeys }: { years: { id: string; name: string; isCurrent: boolean }[]; classes: { id: string; name: string }[]; dueKeys: { key: string; label: string }[] }) {
  const [yearId, setYearId] = useState(years.find((y) => y.isCurrent)?.id ?? years[0]?.id ?? "");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [keys, setKeys] = useState<string[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [all, setAll] = useState(false);
  const [done, setDone] = useState<{ issued: number; skipped: number } | null>(null);
  const [progress, setProgress] = useState<{ n: number; of: number } | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const filter = () => ({ yearId, classIds: classIds.length ? classIds : undefined, dueKeys: keys.length ? keys : undefined });
  const toggle = (set: (f: (x: string[]) => string[]) => void, v: string) => { set((x) => (x.includes(v) ? x.filter((i) => i !== v) : [...x, v])); setPreview(null); setDone(null); };

  const look = () => start(async () => {
    setError(""); setDone(null);
    const r = await previewIssue(JSON.stringify(filter()));
    if (!r.ok) { setError(r.error); return; }
    setPreview(r.data as Preview);
  });

  const issue = () => start(async () => {
    if (!preview) return;
    setError("");
    const ids = [...new Set(preview.rows.map((r) => r.studentId))];
    let issued = 0, skipped = 0;
    setProgress({ n: 0, of: ids.length });
    for (let i = 0; i < ids.length; i += CHUNK) {
      const r = await issueFromPlans(JSON.stringify({ ...filter(), studentIds: ids.slice(i, i + CHUNK) }));
      if (!r.ok) { setError(`${r.error} ${issued} bills were issued before this stopped. Press Preview and issue again: bills already made are never made twice.`); setProgress(null); return; }
      issued += r.data.issued; skipped += r.data.skipped.alreadyIssued + r.data.skipped.noPlan + r.data.skipped.left;
      setProgress({ n: Math.min(ids.length, i + CHUNK), of: ids.length });
    }
    setProgress(null); setPreview(null); setDone({ issued, skipped });
  });

  if (done) return (
    <section className={CARD} aria-live="polite">
      <h2 className="text-lg font-medium">{done.issued ? `${done.issued} bill${done.issued === 1 ? "" : "s"} issued` : "No new bills were made"}</h2>
      <p className={`${MUTED} mt-1`}>{done.skipped ? `${done.skipped} were left out because they already exist, the student has no plan or the student left. ` : ""}Families see their bills now.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/app/fees/invoices?kind=plan" className="inline-flex h-10 items-center rounded-full bg-[var(--ds-primary)] px-5 text-sm font-medium text-[var(--ds-on-primary)]">See the bills</Link>
        <button type="button" onClick={() => setDone(null)} className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm font-medium">Issue more</button>
        <Link href="/app/fees/collect" className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm font-medium">Collect a fee</Link>
      </div>
    </section>
  );

  const shown = preview ? (all ? preview.rows : preview.rows.slice(0, SHOWN)) : [];
  return (
    <div className="flex flex-col gap-5">
      <section className={`${CARD} flex flex-col gap-5`} aria-label="Choose what to issue">
        <label className="flex max-w-xs flex-col gap-1.5 text-sm">Year<select value={yearId} onChange={(e) => { setYearId(e.target.value); setPreview(null); }} className={INPUT}>{years.map((y) => <option key={y.id} value={y.id}>{y.name}{y.isCurrent ? " (this year)" : ""}</option>)}</select></label>
        <fieldset><legend className={H3}>Classes <span className={MUTED}>(none ticked means all)</span></legend>
          <div className="flex flex-wrap gap-2">{classes.map((c) => <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-full bg-white/[0.05] px-3 py-1.5 text-sm has-[:checked]:bg-white/[0.14]"><input type="checkbox" checked={classIds.includes(c.id)} onChange={() => toggle(setClassIds, c.id)} className="accent-[var(--ds-primary)]" />{c.name}</label>)}</div></fieldset>
        <fieldset><legend className={H3}>Bills to make <span className={MUTED}>(none ticked means every due that is ready)</span></legend>
          {dueKeys.length ? <div className="flex flex-wrap gap-2">{dueKeys.map((k) => <label key={k.key} className="flex cursor-pointer items-center gap-2 rounded-full bg-white/[0.05] px-3 py-1.5 text-sm has-[:checked]:bg-white/[0.14]"><input type="checkbox" checked={keys.includes(k.key)} onChange={() => toggle(setKeys, k.key)} className="accent-[var(--ds-primary)]" />{k.label}</label>)}</div> : <p className={MUTED}>This year has no published plan with dues.</p>}</fieldset>
        <div><Button type="button" className="rounded-full" isLoading={pending && !progress} disabled={!yearId || !dueKeys.length} onClick={look}>Preview</Button></div>
      </section>

      {error ? <p role="alert" className="rounded-2xl bg-white/[0.05] p-4 text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}

      {preview ? (
        <section className={CARD} aria-label="What will be issued">
          {preview.count ? (
            <>
              <dl className="mb-4 flex flex-wrap gap-x-10 gap-y-3">
                <div><dt className={MUTED}>Bills</dt><dd className="text-xl font-medium tabular-nums">{preview.count}</dd></div>
                <div><dt className={MUTED}>Billed</dt><dd><Money paise={preview.grossPaise} size="lg" /></dd></div>
                <div><dt className={MUTED}>Concessions</dt><dd><Money paise={-preview.concessionPaise} size="lg" /></dd></div>
                <div><dt className={MUTED}>Families pay</dt><dd><Money paise={preview.grossPaise - preview.concessionPaise} size="lg" /></dd></div>
              </dl>
              <div className="custom-scrollbar overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm"><thead><tr className="text-left text-xs text-[var(--ds-on-surface-muted)]"><th className="py-2 font-normal">Student</th><th className="py-2 font-normal">Bill</th><th className="py-2 font-normal">Due</th><th className="py-2 text-right font-normal">Billed</th><th className="py-2 text-right font-normal">Concession</th><th className="py-2 text-right font-normal">Pays</th></tr></thead>
                  <tbody>{shown.map((r, i) => <tr key={`${r.studentId}${i}`} className="border-t border-white/[0.06]"><td className="py-2"><Link href={`/app/fees/students/${r.studentId}`} className={LINK}>{r.studentName}</Link> <span className={MUTED}>{r.admissionNo}</span></td><td className="py-2">{r.label}</td><td className="py-2 whitespace-nowrap">{r.dueOn}</td><td className="py-2 text-right"><Money paise={r.grossPaise} /></td><td className="py-2 text-right"><Money paise={r.concessionPaise || null} /></td><td className="py-2 text-right"><Money paise={r.duePaise} /></td></tr>)}</tbody></table>
              </div>
              {preview.rows.length > SHOWN && !all ? <button type="button" onClick={() => setAll(true)} className="mt-3 text-sm underline underline-offset-4">Show all {preview.rows.length} bills</button> : null}
            </>
          ) : <EmptyLine title="Nothing to issue" hint="Every bill the plans call for already exists, or no due is ready yet." />}

          {preview.exceptions.length ? <Exceptions list={preview.exceptions} /> : null}

          {preview.count ? (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button type="button" className="rounded-full" isLoading={pending} onClick={issue}>Issue {preview.count} bill{preview.count === 1 ? "" : "s"}</Button>
              {progress ? <p role="status" className="text-sm tabular-nums">Issued for {progress.n} of {progress.of} students<span className="ml-3 inline-block h-1.5 w-40 overflow-hidden rounded-full bg-white/[0.1] align-middle"><span className="block h-full bg-[var(--ds-primary)]" style={{ width: `${(progress.n / progress.of) * 100}%` }} /></span></p> : <p className={MUTED}>Issuing posts each bill to the books and cannot be undone. A wrong bill is cancelled or revised afterwards.</p>}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
