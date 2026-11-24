"use client";

import { useEffect, useId, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconArrowDown, IconArrowUp } from "@tabler/icons-react";
import { DocumentPaper } from "@smw/ui/finance/DocumentPaper";
import { toast } from "@smw/ui/shell/toast";
import {
  DEFAULT_COPIES, FIELDS, FIELD_LABEL, KINDS, KIND_LABEL, LAYOUTS, LAYOUT_LABEL, TOGGLEABLE, applyHidden, copyLabels, sampleData,
  type DocumentKind, type TemplateConfig,
} from "../config";
import { resetTemplate, restoreTemplate, samplePdf, saveTemplate, uploadTemplateImage } from "./actions";

export interface VersionItem { version: number; when: string; by: string | null; isCurrent: boolean }
export interface EditorProps {
  kind: DocumentKind;
  version: number;
  initial: TemplateConfig;
  versions: VersionItem[];
  canEdit: boolean;
  /** Who can change layouts, in words: "administrators". */
  editors: string;
  schoolLogoUrl: string | null;
  qrSvg: string;
  next?: string;
}

const FIELD = "h-10 w-full rounded-xl bg-white/[0.06] px-3 text-sm text-[var(--ds-on-surface)] placeholder:text-[var(--ds-on-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)] disabled:opacity-60";
const BTN = "inline-flex h-10 items-center justify-center whitespace-nowrap rounded-full bg-white/[0.07] px-4 text-sm font-medium transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)] disabled:pointer-events-none disabled:opacity-50";
const PRIMARY = "inline-flex h-10 items-center justify-center whitespace-nowrap rounded-full bg-[var(--ds-primary)] px-5 text-sm font-medium text-[var(--ds-on-primary)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)] disabled:pointer-events-none disabled:opacity-50";
const LEAVE = "You have changes that are not saved. Leave without saving?";

function Group({ title, hint, open, children }: { title: string; hint?: string; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group rounded-2xl bg-white/[0.035] px-4 py-1">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]">
        <span>{title}</span>{hint ? <span className="text-xs font-normal text-[var(--ds-on-surface-muted)]">{hint}</span> : null}
      </summary>
      <div className="flex flex-col gap-3 pb-4 pt-1">{children}</div>
    </details>
  );
}

function Labelled({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return <div className="flex flex-col gap-1.5"><label htmlFor={id} className="text-xs text-[var(--ds-on-surface-muted)]">{label}</label>{children(id)}</div>;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--ds-primary)]" />{label}
    </label>
  );
}

export function TemplateEditor({ kind, version, initial, versions, canEdit, editors, schoolLogoUrl, qrSvg, next }: EditorProps) {
  const router = useRouter();
  const [cfg, setCfg] = useState<TemplateConfig>(initial);
  const [pending, start] = useTransition();
  const dirty = useMemo(() => JSON.stringify(cfg) !== JSON.stringify(initial), [cfg, initial]);
  const set = (patch: Partial<TemplateConfig>) => setCfg((c) => ({ ...c, ...patch }));

  // The browser's own prompt covers closing the tab and reloading; links inside the app ask through `leave`.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const leave = (e: React.MouseEvent) => { if (dirty && !window.confirm(LEAVE)) e.preventDefault(); };
  const discard = () => !dirty || window.confirm("This replaces the changes you have not saved. Continue?");

  const data = useMemo(() => ({ ...sampleData(kind), qrSvg }), [kind, qrSvg]);
  const preview = useMemo(() => ({
    ...cfg,
    logoUrl: cfg.logoUrl ?? schoolLogoUrl,
    copies: cfg.layout === "two_up" ? (copyLabels(cfg) as string[]) : cfg.copies,
  }), [cfg, schoolLogoUrl]);
  const shown = useMemo(() => applyHidden(cfg, data), [cfg, data]);

  const run = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, then?: () => void) => start(async () => {
    const r = await fn();
    if (!r.ok) { toast(r.error, "danger"); return; }
    toast(r.message ?? "Done");
    then ? then() : router.refresh();
  });
  const save = (goNext = false) => run(() => saveTemplate(kind, cfg), goNext && next ? () => router.push(next) : undefined);

  const upload = (which: "logo" | "signature", file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.set("which", which); fd.set("file", file);
    start(async () => {
      const r = await uploadTemplateImage(fd);
      if (!r.ok) { toast(r.error, "danger"); return; }
      if (which === "logo") set({ logoUrl: r.data.url });
      else set({ signature: { name: cfg.signature?.name ?? "", title: cfg.signature?.title ?? "", imageUrl: r.data.url } });
    });
  };

  const openSample = () => start(async () => {
    const r = await samplePdf(kind, cfg);
    if (!r.ok) { toast(r.error, "danger"); return; }
    const bytes = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
    window.open(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })), "_blank");
  });

  const move = (i: number, d: -1 | 1) => setCfg((c) => {
    const cols = [...c.columns], [a, b] = [cols[i], cols[i + d]];
    if (!a || !b) return c;
    cols[i] = b; cols[i + d] = a;
    return { ...c, columns: cols };
  });
  const toggle = (list: "hiddenFacts" | "hiddenTotals", label: string, hidden: boolean) =>
    set({ [list]: hidden ? [...cfg[list], label] : cfg[list].filter((x) => x !== label) });
  const sig = cfg.signature ?? { name: "", title: "", imageUrl: null };
  const q = (k: DocumentKind) => `?kind=${k}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Document kind" className="flex gap-2 overflow-x-auto pb-1">
        {KINDS.map((k) => (
          <Link key={k} href={q(k)} onClick={leave} aria-current={k === kind ? "page" : undefined}
            className={`inline-flex h-10 shrink-0 items-center rounded-full px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)] ${k === kind ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary)]" : "bg-white/[0.06] hover:bg-white/[0.1]"}`}>{KIND_LABEL[k]}</Link>
        ))}
      </nav>

      {!canEdit ? (
        <p role="note" className="rounded-2xl bg-white/[0.05] p-4 text-sm">Only {editors} can change how documents look. You can look at the layout and print a sample. Ask {editors} if something needs to change.</p>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <fieldset disabled={!canEdit} className="flex min-w-0 flex-col gap-3 border-0 p-0">
          <legend className="sr-only">Layout options</legend>
          <Group title="Page" open>
            <Labelled label="Paper">{(id) => (
              <select id={id} className={FIELD} value={cfg.layout} onChange={(e) => {
                const layout = e.target.value as TemplateConfig["layout"];
                set({ layout, copies: layout === "two_up" && !cfg.copies?.length ? DEFAULT_COPIES : cfg.copies });
              }}>{LAYOUTS.map((l) => <option key={l} value={l}>{LAYOUT_LABEL[l]}</option>)}</select>
            )}</Labelled>
            <Labelled label="Title">{(id) => <input id={id} className={FIELD} value={cfg.title} maxLength={60} onChange={(e) => set({ title: e.target.value })} />}</Labelled>
            <Labelled label="Colour">{(id) => (
              <select id={id} className={FIELD} value={cfg.accent} onChange={(e) => set({ accent: e.target.value as "theme" | "none" })}>
                <option value="theme">School colour</option><option value="none">Black only</option>
              </select>
            )}</Labelled>
            {cfg.layout === "two_up" ? (
              <div className="grid grid-cols-2 gap-2">
                {[0, 1].map((i) => (
                  <Labelled key={i} label={i ? "Second copy label" : "First copy label"}>{(id) => (
                    <input id={id} className={FIELD} value={copyLabels(cfg)[i] ?? ""} maxLength={30} onChange={(e) => { const c = [...copyLabels(cfg)] as string[]; c[i] = e.target.value; set({ copies: c }); }} />
                  )}</Labelled>
                ))}
              </div>
            ) : null}
          </Group>

          <Group title="Header" hint="Logo, name, address">
            <Labelled label="Lines under the logo, one per line (school name first)">{(id) => (
              <textarea id={id} rows={4} className={`${FIELD} h-auto py-2`} value={cfg.headerLines.join("\n")} onChange={(e) => set({ headerLines: e.target.value.split("\n").slice(0, 8) })} />
            )}</Labelled>
            <Labelled label="Logo">{(id) => (
              <div className="flex flex-wrap items-center gap-2">
                <input id={id} type="file" accept="image/png,image/jpeg,image/webp" className="max-w-full text-xs" onChange={(e) => upload("logo", e.target.files?.[0])} />
                {cfg.logoUrl ? <button type="button" className={BTN} onClick={() => set({ logoUrl: null })}>Use the school logo</button> : <span className="text-xs text-[var(--ds-on-surface-muted)]">{schoolLogoUrl ? "Using the school logo." : "No logo yet. Upload one here or in School settings."}</span>}
              </div>
            )}</Labelled>
          </Group>

          <Group title="What shows" hint="Switch parts on or off">
            {FIELDS.map((f) => <Check key={f} label={FIELD_LABEL[f]} checked={cfg.showFields?.[f] !== false} onChange={(v) => set({ showFields: { ...cfg.showFields, [f]: v } })} />)}
            {TOGGLEABLE[kind].facts.length || TOGGLEABLE[kind].totals.length ? <p className="pt-1 text-xs text-[var(--ds-on-surface-muted)]">Details to show when the document has them</p> : null}
            {TOGGLEABLE[kind].facts.map((l) => <Check key={l} label={l} checked={!cfg.hiddenFacts.includes(l)} onChange={(v) => toggle("hiddenFacts", l, !v)} />)}
            {TOGGLEABLE[kind].totals.map((l) => <Check key={l} label={l} checked={!cfg.hiddenTotals.includes(l)} onChange={(v) => toggle("hiddenTotals", l, !v)} />)}
          </Group>

          <Group title="Columns" hint="Order, names, on or off">
            {cfg.columns.map((c, i) => (
              <div key={c.key} className="flex items-center gap-2">
                <input type="checkbox" aria-label={`Show ${c.label || c.key}`} checked={c.show} onChange={(e) => set({ columns: cfg.columns.map((x, j) => (j === i ? { ...x, show: e.target.checked } : x)) })} className="h-4 w-4 shrink-0 accent-[var(--ds-primary)]" />
                <input aria-label={`Name of column ${c.key}`} className={FIELD} value={c.label} maxLength={40} onChange={(e) => set({ columns: cfg.columns.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                <button type="button" aria-label={`Move ${c.label || c.key} up`} disabled={i === 0} className={`${BTN} !w-10 !px-0`} onClick={() => move(i, -1)}><IconArrowUp className="h-4 w-4" aria-hidden /></button>
                <button type="button" aria-label={`Move ${c.label || c.key} down`} disabled={i === cfg.columns.length - 1} className={`${BTN} !w-10 !px-0`} onClick={() => move(i, 1)}><IconArrowDown className="h-4 w-4" aria-hidden /></button>
              </div>
            ))}
          </Group>

          <Group title="Words" hint="Terms, footer, watermark">
            <Labelled label="Terms">{(id) => <textarea id={id} rows={3} className={`${FIELD} h-auto py-2`} value={cfg.terms ?? ""} maxLength={1000} onChange={(e) => set({ terms: e.target.value })} />}</Labelled>
            <Labelled label="Footer">{(id) => <input id={id} className={FIELD} value={cfg.footer ?? ""} maxLength={200} onChange={(e) => set({ footer: e.target.value })} />}</Labelled>
            <Labelled label="Watermark (faint text across the page)">{(id) => <input id={id} className={FIELD} value={cfg.watermark ?? ""} maxLength={30} onChange={(e) => set({ watermark: e.target.value })} />}</Labelled>
          </Group>

          <Group title="Signature">
            <Labelled label="Name">{(id) => <input id={id} className={FIELD} value={sig.name} maxLength={60} onChange={(e) => set({ signature: { ...sig, name: e.target.value } })} />}</Labelled>
            <Labelled label="Title">{(id) => <input id={id} className={FIELD} value={sig.title} maxLength={60} onChange={(e) => set({ signature: { ...sig, title: e.target.value } })} />}</Labelled>
            <Labelled label="Signature image">{(id) => (
              <div className="flex flex-wrap items-center gap-2">
                <input id={id} type="file" accept="image/png,image/jpeg,image/webp" className="max-w-full text-xs" onChange={(e) => upload("signature", e.target.files?.[0])} />
                {sig.imageUrl ? <button type="button" className={BTN} onClick={() => set({ signature: { ...sig, imageUrl: null } })}>Remove image</button> : null}
              </div>
            )}</Labelled>
            {cfg.signature ? <button type="button" className={BTN} onClick={() => set({ signature: null })}>Remove the signature block</button> : null}
          </Group>
        </fieldset>

        <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-4">
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? <button type="button" className={PRIMARY} disabled={!dirty || pending} onClick={() => save()}>{dirty ? "Save as a new version" : "Saved"}</button> : null}
            {canEdit && next ? <button type="button" className={BTN} disabled={pending || !dirty} onClick={() => save(true)}>Save and go back</button> : null}
            <button type="button" className={BTN} disabled={pending} onClick={openSample}>Print a sample PDF</button>
            {canEdit ? <button type="button" className={BTN} disabled={pending} onClick={() => { if (window.confirm("Go back to the built-in layout? It is saved as a new version, so older versions stay available.")) run(() => resetTemplate(kind)); }}>Reset to built-in</button> : null}
            {next ? <Link href={next} onClick={leave} className={BTN}>Back to where you were</Link> : null}
          </div>
          <p className="text-xs text-[var(--ds-on-surface-muted)]" aria-live="polite">
            {dirty ? "You have changes that are not saved." : version ? `Showing version ${version}.` : "Showing the built-in layout. Nothing is saved yet."} The preview uses made-up details.
          </p>
          <DocumentPaper config={preview} data={shown} kind={kind} />

          <section aria-label="Versions" className="rounded-2xl bg-white/[0.035] p-4">
            <h2 className="text-sm font-medium">Versions</h2>
            {versions.length ? (
              <ul className="mt-2 flex flex-col">
                {versions.map((v) => (
                  <li key={v.version} className="flex min-h-11 flex-wrap items-center gap-3 text-sm">
                    <span className="font-medium tabular-nums">Version {v.version}</span>
                    <span className="min-w-0 flex-1 text-xs text-[var(--ds-on-surface-muted)]">{v.when}{v.by ? `, ${v.by}` : ""}{v.isCurrent ? ", in use" : ""}</span>
                    {canEdit && !v.isCurrent ? <button type="button" className={BTN} disabled={pending} onClick={() => { if (discard()) run(() => restoreTemplate(kind, v.version)); }}>Restore</button> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">Nothing saved yet. Documents print with the built-in layout. Save to start version 1. Documents already issued keep the version they were printed with.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
