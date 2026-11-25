"use client";
/* eslint-disable @next/next/no-img-element -- thumbnails of the school's own uploads */

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconFileTypePdf, IconLayoutGrid, IconList } from "@tabler/icons-react";
import { CopyValue } from "@smw/ui/finance/CopyValue";
import { EmptyLine } from "@smw/ui/finance/States";
import { PILL_BTN } from "@smw/ui/finance/ui";
import { Modal, ModalFooter } from "@smw/ui/kit/Modal";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { Button } from "@smw/ui/ui/button";
import { cn } from "@smw/ui/utils";
import { removeMedia, replaceMedia, setMediaAlt, uploadMedia } from "./site-actions";
import { shrink } from "./shrink-image";

export interface MediaCard { id: string; kind: "photo" | "document"; url: string; viewUrl: string; fileName: string; size: number; alt: string; places: { where: "draft" | "live" | "disclosure"; label: string; href: string }[] }
const M = "text-[var(--ds-on-surface-muted)]";
const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const WHERE = { draft: "In the draft", live: "On the live site", disclosure: "In the disclosure" } as const;

export function MediaClient({ items, canManage, view, q, kind, unused }: { items: MediaCard[]; canManage: boolean; view: "grid" | "list"; q: string; kind: string; unused: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<MediaCard | null>(null);
  const [pending, start] = useTransition();
  const href = (o: Record<string, string>) => `/app/website/media?${new URLSearchParams(Object.entries({ q, kind, view, filter: unused ? "unused" : "", ...o }).filter(([, v]) => v)).toString()}`;

  const upload = async (files: File[]) => {
    setBusy(true);
    let ok = 0;
    for (const f of files) {
      const fd = new FormData();
      fd.set("file", f.type.startsWith("image/") ? await shrink(f) : f);
      const r = await uploadMedia(fd);
      if (r.ok) ok++; else toast(`${f.name}: ${r.error}`, "danger");
    }
    setBusy(false);
    if (ok) { toast(`${ok} file${ok === 1 ? "" : "s"} uploaded. Add a description to each photo.`); router.refresh(); }
  };
  const del = (m: MediaCard) => start(async () => {
    const fd = new FormData(); fd.set("id", m.id);
    const r = await removeMedia(fd);
    setAsking(null);
    if (r.ok) { toast("Deleted"); router.refresh(); } else toast(r.error, "danger");
  });

  return (
    <div className="pb-8">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form action="/app/website/media" className="flex min-w-0 flex-1 flex-wrap items-center gap-2" role="search">
          <input name="q" defaultValue={q} aria-label="Search files" placeholder="Search by name or description" className={cn(INPUT, "h-10 min-w-0 max-w-xs flex-1")} />
          <select name="kind" defaultValue={kind} aria-label="Kind" className={cn(INPUT, "h-10 w-auto")}><option value="">Photos and documents</option><option value="photo">Photos</option><option value="document">Documents (PDF)</option></select>
          <select name="filter" defaultValue={unused ? "unused" : ""} aria-label="Where used" className={cn(INPUT, "h-10 w-auto")}><option value="">All</option><option value="unused">Not used anywhere</option></select>
          <input type="hidden" name="view" value={view} />
          <Button type="submit" variant="secondary" className="rounded-full">Search</Button>
        </form>
        <div className="flex items-center gap-1" role="group" aria-label="View">
          <Link href={href({ view: "grid" })} aria-label="Grid" aria-current={view === "grid"} className={cn("inline-flex h-10 w-10 items-center justify-center rounded-full", view === "grid" ? "bg-white/[0.12]" : "hover:bg-white/[0.08]")}><IconLayoutGrid className="h-4 w-4" aria-hidden /></Link>
          <Link href={href({ view: "list" })} aria-label="List" aria-current={view === "list"} className={cn("inline-flex h-10 w-10 items-center justify-center rounded-full", view === "list" ? "bg-white/[0.12]" : "hover:bg-white/[0.08]")}><IconList className="h-4 w-4" aria-hidden /></Link>
        </div>
        {canManage ? (
          <>
            <input ref={input} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) void upload(f); }} />
            <Button type="button" className="rounded-full" isLoading={busy} onClick={() => input.current?.click()}>Upload photos or PDFs</Button>
          </>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyLine title={q || kind || unused ? "No file matches." : "No photos or documents yet."} hint={q || kind || unused ? undefined : "Upload your campus photos and PDFs like the prospectus. They appear here with where each one is used."}
          action={canManage && !(q || kind || unused) ? <Button type="button" className="rounded-full" onClick={() => input.current?.click()}>Upload your first file</Button> : undefined} />
      ) : (
        <ul className={view === "grid" ? "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-2"}>
          {items.map((m) => (
            <li key={m.id} className={cn("rounded-3xl bg-[var(--ds-surface-container-low)] p-4", view === "list" && "flex flex-wrap items-start gap-4")}>
              <div className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/[0.05]", view === "grid" ? "mb-3 aspect-[4/3] w-full" : "h-20 w-28")}>
                {m.kind === "photo" ? <img src={m.viewUrl} alt={m.alt} loading="lazy" className="h-full w-full object-cover" /> : <IconFileTypePdf className={cn("h-10 w-10", M)} aria-label="PDF" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={m.fileName}>{m.fileName}</p>
                <p className={cn("text-xs", M)}>{m.kind === "photo" ? "Photo" : "PDF"} · {kb(m.size)}</p>
                <AltField m={m} canManage={canManage} />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {m.places.length === 0 ? <ToneBadge label="Not used anywhere" tone="default" /> : m.places.map((p) => <span key={`${p.where}${p.label}`} className="inline-flex items-center gap-1.5 text-xs"><ToneBadge label={WHERE[p.where]} tone={p.where === "live" ? "success" : "default"} /><Link href={p.href} className="text-[var(--ds-primary-text)] hover:underline">{p.label}</Link></span>)}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <CopyValue value={m.url} label="file address" maxWidth="14ch" />
                  <a href={m.url} target="_blank" rel="noopener" className={cn(PILL_BTN, "h-9")}>Open</a>
                  {canManage ? <ReplaceButton m={m} /> : null}
                  {canManage && !m.places.some((p) => p.where !== "draft") ? <Button type="button" size="sm" variant="ghost" className="rounded-full text-[var(--ds-color-danger-400)]" onClick={() => setAsking(m)}>Delete</Button> : null}
                  {canManage && m.places.some((p) => p.where !== "draft") ? <span className={cn("text-xs", M)}>Used on the live site: take it off the places above and publish to delete it.</span> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={!!asking} onOpenChange={(o) => !o && setAsking(null)} size="sm" tone="danger" title={`Delete ${asking?.fileName ?? "this file"}?`}
        description={asking?.places.some((p) => p.where !== "draft") ? `It is used on ${asking.places.filter((p) => p.where !== "draft").map((p) => p.label).join("; ")}. Deleting is refused until you take it off and publish.` : "It cannot be brought back. Pages that still show it from the draft will show an empty space until you choose another."}
        footer={<ModalFooter danger secondary={{ onClick: () => setAsking(null) }} primary={{ label: "Delete", loading: pending, onClick: () => asking && del(asking) }} />}>
        <p className={cn("text-sm", M)}>Replace it instead to keep the same address everywhere.</p>
      </Modal>
    </div>
  );
}

function AltField({ m, canManage }: { m: MediaCard; canManage: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(m.alt);
  if (m.kind !== "photo") return null;
  if (!canManage) return <p className={cn("mt-1 text-xs", M)}>{m.alt || "No description"}</p>;
  const save = async () => {
    if (v.trim() === m.alt) return;
    const fd = new FormData(); fd.set("id", m.id); fd.set("alt", v);
    const r = await setMediaAlt(fd);
    if (r.ok) { toast("Description saved"); router.refresh(); } else toast(r.error, "danger");
  };
  return (
    <label className="mt-2 block text-xs">
      <span className={M}>Description for people who cannot see it</span>
      <input value={v} maxLength={200} onChange={(e) => setV(e.target.value)} onBlur={save} placeholder="Children playing football on the school ground" className={cn(INPUT, "mt-1 h-9 text-xs")} />
    </label>
  );
}

function ReplaceButton({ m }: { m: MediaCard }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input ref={input} type="file" hidden accept={m.kind === "photo" ? "image/png,image/jpeg,image/webp" : "application/pdf"} onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = "";
        if (!f) return;
        setBusy(true);
        const fd = new FormData(); fd.set("id", m.id); fd.set("file", m.kind === "photo" ? await shrink(f) : f);
        const r = await replaceMedia(fd);
        setBusy(false);
        if (r.ok) { toast("Replaced. Every page shows the new file."); router.refresh(); } else toast(r.error, "danger");
      }} />
      <Button type="button" size="sm" variant="secondary" className="rounded-full" isLoading={busy} onClick={() => input.current?.click()}>Replace</Button>
    </>
  );
}
