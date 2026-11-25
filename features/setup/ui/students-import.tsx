"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ImportReport } from "@smw/feature-students/service";
import { StatCard } from "@smw/ui/kit/StatCard";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { checkStudents, importStudents } from "./actions";
import { StepFooter, useStepRun } from "./wizard";

const SHOWN_PROBLEMS = 8;

/** Pick a CSV: it is checked at once (nothing is saved), problems are listed by line, and the import button says how many students it will add. */
export function StudentsImport({ existing, next, back, skip }: { existing: number; next: string; back: string | null; skip: string }) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const { pending, run } = useStepRun(next);

  const onFile = async (file: File | undefined) => {
    setReport(null); setFileError(null); setCsv("");
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    startCheck(async () => {
      const r = await checkStudents(text);
      if (r.ok) setReport(r.data);
      else { setFileError(r.fieldErrors?.file ?? r.error); toast(r.error, "danger"); }
    });
  };

  const problems = report?.rows.filter((r) => r.errors.length) ?? [];
  const canImport = !!report && report.failed === 0 && report.valid > 0 && !report.limitMessage;

  return (
    <div>
      {existing > 0 ? (
        <p className="mb-5 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-[var(--ds-on-surface-variant)]">
          You already have {existing} {existing === 1 ? "student" : "students"}. A new file adds to them.
        </p>
      ) : null}
      <ol className="flex flex-col gap-5 text-sm">
        <li>
          <p className="font-medium text-[var(--ds-on-surface)]">1. Get the template</p>
          <p className="mt-1 text-[var(--ds-on-surface-muted)]">Name, class and section are required. Leave the admission number blank and we number them for you. Class and section must match what you just created.</p>
          <a href="/app/students/import/template" download className="mt-2 inline-block text-[var(--ds-primary-text)] hover:underline">Download students-template.csv</a>
        </li>
        <li>
          <label htmlFor="students-csv" className="font-medium text-[var(--ds-on-surface)]">2. Choose your filled file</label>
          <input id="students-csv" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} aria-invalid={!!fileError}
            className={`${INPUT} mt-2 py-2 file:mr-3 file:rounded-full file:border-0 file:bg-white/[0.08] file:px-3 file:text-[var(--ds-on-surface)]`} />
          {fileError ? <p role="alert" className="mt-2 text-[var(--ds-color-danger-300)]">{fileError}</p> : null}
          {checking ? <p className="mt-2 text-[var(--ds-on-surface-muted)]">Checking every row. Nothing is saved yet.</p> : null}
        </li>
      </ol>

      {report ? (
        <div className="mt-6">
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Rows" value={String(report.total)} />
            <StatCard label="Ready" value={String(report.valid)} />
            <StatCard label="Need a fix" value={String(report.failed)} />
          </div>
          {report.limitMessage ? <p role="alert" className="mt-4 text-sm text-[var(--ds-color-warning-400)]">{report.limitMessage}</p> : null}
          {problems.length ? (
            <div className="mt-4">
              <p className="text-sm text-[var(--ds-on-surface)]">Fix these in your file and choose it again. Nothing is imported until every row passes.</p>
              <ul className="mt-3 flex flex-col gap-2">
                {problems.slice(0, SHOWN_PROBLEMS).map((r) => (
                  <li key={r.line} className="rounded-2xl bg-white/[0.04] px-4 py-3 text-sm">
                    <div className="flex items-center gap-2"><ToneBadge label={`Line ${r.line}`} tone="danger" /><span className="truncate text-[var(--ds-on-surface)]">{r.name ?? "No name"}</span></div>
                    <p className="mt-1 text-[var(--ds-on-surface-muted)]">{r.errors.join(". ")}</p>
                  </li>
                ))}
              </ul>
              {problems.length > SHOWN_PROBLEMS ? <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">and {problems.length - SHOWN_PROBLEMS} more rows</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <StepFooter back={back} skip={existing > 0 ? undefined : skip} pending={pending} disabled={existing > 0 ? false : !canImport}
        label={canImport ? `Import ${report!.valid} students` : existing > 0 ? "Continue" : "Import students"}
        summary={!report && existing === 0 ? "Or skip, and add students one by one later" : undefined}
        onClick={canImport ? () => run(() => importStudents(csv)) : () => router.push(next)} />
      {existing > 0 && !canImport ? null : existing > 0 ? <p className="mt-3 text-right text-xs"><Link href={next} className="text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">Skip this file</Link></p> : null}
    </div>
  );
}
