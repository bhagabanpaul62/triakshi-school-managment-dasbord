"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@smw/ui/kit/Panel";
import { Modal, ModalField, ModalFooter } from "@smw/ui/kit/Modal";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { Button } from "@smw/ui/ui/button";
import { cn } from "@smw/ui/utils";
import { putDisclosureOnSite, saveDisclosureRow } from "./site-actions";

type State = "filled" | "missing" | "na" | "expiring" | "expired";
export interface LineView { key: string; label: string; kind: "text" | "document" | "link"; expires: boolean; state: State; days: number | null; profileText: string | null; text: string; url: string; fileName: string; expiresOn: string; na: boolean }
export interface PartView { key: string; label: string; done: number; total: number; lines: LineView[] }
const M = "text-[var(--ds-on-surface-muted)]";
const BADGE: Record<State, [string, "success" | "warning" | "danger" | "default"]> = { filled: ["Filled", "success"], missing: ["Missing", "warning"], na: ["Not applicable", "default"], expiring: ["Expires soon", "warning"], expired: ["Expired", "danger"] };

export function DisclosureClient({ parts, counts, total, title, onSite, canManage }: {
  parts: PartView[]; counts: Record<State, number>; total: number; title: string; canManage: boolean;
  onSite: { slug: string; live: boolean; changedSince: boolean } | null;
}) {
  const router = useRouter();
  const [edit, setEdit] = useState<LineView | null>(null);
  const [pending, start] = useTransition();
  const done = total - counts.missing;
  const put = () => start(async () => {
    const r = await putDisclosureOnSite();
    if (r.ok) { toast(r.message ?? "On your draft"); router.refresh(); } else toast(r.error, "danger");
  });
  const problems = counts.expired + counts.expiring;

  return (
    <div className="pb-8">
      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-12">
        <Panel title={`${done} of ${total} rows filled`} className="h-auto lg:col-span-7">
          <div className="mb-3 h-2 rounded-full bg-white/[0.06]"><div className="h-2 rounded-full bg-[var(--ds-primary)]" style={{ width: `${(done / total) * 100}%` }} /></div>
          <p className={cn("text-sm", M)}>
            {counts.missing} missing{counts.na ? `, ${counts.na} not applicable` : ""}.
            {problems ? <span className="text-[var(--ds-color-warning-400)]"> {counts.expired ? `${counts.expired} document${counts.expired === 1 ? " has" : "s have"} run out. ` : ""}{counts.expiring ? `${counts.expiring} run out within 30 days.` : ""}</span> : null}
          </p>
        </Panel>
        <Panel title="On your website" className="h-auto lg:col-span-5">
          {onSite ? (
            <p className="mb-3 text-sm">{onSite.live ? <>Visitors can see the page at <Link href={`/${onSite.slug}`} className="text-[var(--ds-primary-text)] hover:underline">/{onSite.slug}</Link>.</> : <>The page is in your draft at /{onSite.slug}. Publish to show it to visitors.</>}{onSite.changedSince ? " The rows below have changed since you last put it on." : ""}</p>
          ) : <p className={cn("mb-3 text-sm", M)}>The page is not on your website yet. One button makes it and adds a link in the footer.</p>}
          {canManage ? <Button type="button" className="rounded-full" isLoading={pending} disabled={!!onSite && !onSite.changedSince && onSite.live} onClick={put}>{onSite ? "Update the page on the site" : "Put on the site"}</Button> : null}
          <p className={cn("mt-3 text-xs", M)}>The page keeps a copy of the rows as they are now. It does not make the school compliant by itself.</p>
        </Panel>
      </div>

      {parts.map((p) => (
        <Panel key={p.key} title={`${p.label} (${p.done} of ${p.total})`} className="mb-3 h-auto">
          <ul className="flex flex-col gap-1">
            {p.lines.map((l) => {
              const [label, tone] = BADGE[l.state];
              return (
                <li key={l.key} className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/[0.035] px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{l.label}</p>
                    <p className={cn("truncate text-xs", M)}>
                      {l.na ? "Marked not applicable" : l.kind === "document" ? (l.url ? <>{l.fileName || "File"}{l.expiresOn ? `, valid until ${l.expiresOn}` : ""}</> : "No file yet") : l.text || (l.profileText ? `From your school details: ${l.profileText}` : l.url ? l.url : "Not filled in")}
                    </p>
                  </div>
                  <ToneBadge label={l.state === "expiring" && l.days !== null ? `Expires in ${l.days} day${l.days === 1 ? "" : "s"}` : label} tone={tone} />
                  {l.url && l.kind === "document" ? <a href={l.url} target="_blank" rel="noopener" className="text-sm text-[var(--ds-primary-text)] hover:underline">Open</a> : null}
                  {canManage ? <Button type="button" size="sm" variant="secondary" className="rounded-full" onClick={() => setEdit(l)}>{l.state === "missing" ? "Fill in" : "Change"}</Button> : null}
                </li>
              );
            })}
          </ul>
        </Panel>
      ))}
      {edit ? <RowDialog line={edit} onClose={() => setEdit(null)} title={title} /> : null}
    </div>
  );
}

function RowDialog({ line, onClose, title }: { line: LineView; onClose: () => void; title: string }) {
  const router = useRouter();
  const [text, setText] = useState(line.text || (line.state === "missing" ? "" : ""));
  const [url, setUrl] = useState(line.url);
  const [exp, setExp] = useState(line.expiresOn);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = (extra: Record<string, string>) => start(async () => {
    const fd = new FormData();
    fd.set("key", line.key);
    if (extra.clear || extra.na) for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    else {
      if (line.kind === "text") fd.set("text", text);
      if (line.kind === "link") fd.set("url", url);
      if (line.kind === "document") { if (file) fd.set("file", file); else { fd.set("url", url); fd.set("fileName", line.fileName); } if (line.expires && exp) fd.set("expiresOn", exp); }
    }
    const r = await saveDisclosureRow(fd);
    if (r.ok) { toast("Saved"); onClose(); router.refresh(); } else setError(r.error);
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} size="md" title={line.label} description={`Part of the ${title.toLowerCase()}. Visitors see it once you put the page on the site.`}
      footer={<ModalFooter secondary={{ onClick: onClose }} primary={{ label: "Save", loading: pending, onClick: () => send({}) }}
        extra={<span className="flex gap-2">{line.state !== "missing" ? <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => send({ clear: "1" })}>Empty this row</Button> : null}<Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => send({ na: "true" })}>Not applicable</Button></span>} />}>
      {line.kind === "text" ? (
        <ModalField label="Answer" htmlFor="d-text" hint={line.profileText ? `Leave empty to use your school details: ${line.profileText}` : undefined}>
          <textarea id="d-text" rows={3} maxLength={600} className={cn(INPUT, "h-auto py-2")} value={text} onChange={(e) => setText(e.target.value)} />
        </ModalField>
      ) : line.kind === "link" ? (
        <ModalField label="Link" htmlFor="d-url" hint="A video or page, starting with https://">
          <input id="d-url" className={INPUT} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
        </ModalField>
      ) : (
        <div className="flex flex-col gap-4">
          <ModalField label="PDF file" htmlFor="d-file" hint={line.url ? `Now: ${line.fileName || "a file"}. Choose another to replace it.` : "A PDF of the document. It is public once the page is on the site."}>
            <input id="d-file" type="file" accept="application/pdf" className={INPUT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </ModalField>
          {line.expires ? (
            <ModalField label="Valid until" htmlFor="d-exp" hint="You are told 30 days before it runs out and again when it has.">
              <input id="d-exp" type="date" className={INPUT} value={exp} onChange={(e) => setExp(e.target.value)} />
            </ModalField>
          ) : null}
        </div>
      )}
      {error ? <p role="alert" className="mt-3 text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
    </Modal>
  );
}
