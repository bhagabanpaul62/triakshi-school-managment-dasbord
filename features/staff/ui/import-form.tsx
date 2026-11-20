"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";
import type { ImportReport, ImportResult } from "../import";

type Action = (fd: FormData) => Promise<FormResult & { data?: unknown }>;

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

/** The links CSV is built here from the result on screen, so the server never stores it. */
function downloadLinks(result: ImportResult) {
  const rows = [["name", "role", "login_id", "access_link"], ...result.people.filter((p) => p.accessLink).map((p) => [p.name, p.role, p.loginId, p.accessLink!])];
  const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\r\n")], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "staff-access-links.csv" });
  a.click();
  URL.revokeObjectURL(url);
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); } catch { toast("Could not copy. Select the link and copy it.", "danger"); }
}

/** Step 1 choose a file and check it (nothing is written), step 2 import it, then the result with logins and links. */
export function ImportForm({ check, commit }: { check: Action; commit: Action }) {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
    if (r.ok) { setResult(r.data as ImportResult); toast(`${(r.data as ImportResult).imported} people added`); }
    else { setError(r.fieldErrors?.file ?? r.error); toast(r.error, "danger"); }
  });

  if (result) {
    const links = result.people.filter((p) => p.accessLink);
    return (
      <Panel title={`${result.imported} people added`}
        action={links.length ? <Button type="button" className="rounded-full" onClick={() => downloadLinks(result)}>Download links (CSV)</Button> : undefined}>
        {links.length ? <p className="mb-4 text-sm text-[var(--ds-on-surface-variant)]">{links.length} have no email. Share their link (WhatsApp works); each works once for 7 days. These links are shown only on this page, so copy or download them now.</p>
          : <p className="mb-4 text-sm text-[var(--ds-on-surface-variant)]">Everyone has an email, so every invite was sent.</p>}
        <div className="custom-scrollbar -mx-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">
                <th scope="col" className="px-2 pb-2 font-normal">Name</th>
                <th scope="col" className="px-2 pb-2 font-normal">Role</th>
                <th scope="col" className="px-2 pb-2 font-normal">Login ID</th>
                <th scope="col" className="px-2 pb-2 font-normal">Invite</th>
              </tr>
            </thead>
            <tbody>
              {result.people.map((p) => (
                <tr key={p.loginId} className="align-top transition-colors hover:bg-white/[0.04]">
                  <td className="px-2 py-2">{p.name}</td>
                  <td className="px-2 py-2 text-[var(--ds-on-surface-muted)]">{p.role}</td>
                  <td className="px-2 py-2 font-mono text-xs">{p.loginId}</td>
                  <td className="px-2 py-2">
                    {p.accessLink ? <Button type="button" variant="secondary" size="sm" className="rounded-full" onClick={() => copy(p.accessLink!)}>Copy link</Button>
                      : p.emailed ? <ToneBadge label="Emailed" tone="success" /> : <ToneBadge label="Email failed: resend from the staff page" tone="warning" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Link href="/app/staff" className="mt-4 inline-block text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">Back to staff</Link>
      </Panel>
    );
  }

  const problems = report?.rows.filter((r) => r.errors.length) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <Panel title="1. Choose a file">
        <div className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".xlsx,.csv,text/csv" aria-label="Spreadsheet file" className={`${INPUT} max-w-sm py-2 file:mr-3 file:rounded-full file:border-0 file:bg-white/[0.08] file:px-3 file:text-[var(--ds-on-surface)]`}
            onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); setError(null); }} />
          <Button type="button" className="rounded-full" onClick={runCheck} disabled={!file} isLoading={pending && !report}>Check file</Button>
        </div>
        {error ? <p role="alert" className="mt-3 text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
      </Panel>

      {report ? (
        <Panel title="2. Review"
          action={<Button type="button" className="rounded-full" onClick={runImport} disabled={report.failed > 0 || report.valid === 0} isLoading={pending}>Import {report.valid} people</Button>}>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="tabular-nums">{report.total} rows</span>
            <ToneBadge label={`${report.valid} ready`} tone="success" />
            {report.failed ? <ToneBadge label={`${report.failed} with problems`} tone="danger" /> : null}
          </div>
          {problems.length === 0 ? (
            <WidgetEmptyState title="Every row looks good." description="Nothing is saved until you press Import." />
          ) : (
            <div className="custom-scrollbar -mx-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">
                    <th scope="col" className="px-2 pb-2 font-normal">Line</th>
                    <th scope="col" className="px-2 pb-2 font-normal">Person</th>
                    <th scope="col" className="px-2 pb-2 font-normal">What to fix</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.map((r) => (
                    <tr key={r.line} className="align-top transition-colors hover:bg-white/[0.04]">
                      <td className="px-2 py-2 tabular-nums text-[var(--ds-on-surface-muted)]">{r.line}</td>
                      <td className="px-2 py-2">{r.name || "-"}</td>
                      <td className="px-2 py-2"><ul className="flex flex-col gap-1">{r.errors.map((e) => <li key={e.column} className="text-[var(--ds-color-danger-400)]"><span className="font-mono text-xs">{e.column}</span>: {e.message}</li>)}</ul></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 text-xs text-[var(--ds-on-surface-muted)]">Line numbers match your file (line 1 is the header). The import is all or nothing.</p>
        </Panel>
      ) : null}
    </div>
  );
}
