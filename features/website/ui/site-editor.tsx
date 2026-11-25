"use client";
/* eslint-disable @next/next/no-img-element -- thumbnails of school uploads and arbitrary https links */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IconArrowDown, IconArrowUp, IconDeviceDesktop, IconDeviceMobile, IconDeviceTablet, IconExternalLink, IconEyeOff, IconGripVertical, IconPhoto, IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";
import {
  EDITOR_FIELDS, HOME_SLUG, SECTION_META, SECTION_TYPES, TEMPLATES, TEMPLATE_KEYS, sectionHash,
  type EditField, type Section, type SectionType, type SiteContent, type TemplateKey,
} from "@smw/site-templates";
import { Panel } from "@smw/ui/kit/Panel";
import { Modal, ModalField } from "@smw/ui/kit/Modal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal, INPUT } from "@smw/ui/shell/FormModal";
import { MenuItem, MoreMenu } from "@smw/ui/shell/MoreMenu";
import { toast } from "@smw/ui/shell/toast";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { Button } from "@smw/ui/ui/button";
import { cn } from "@smw/ui/utils";
import { addPage, setTemplate, updatePage } from "./actions";
import { addSectionAt, draftInfo, listMedia, removeMedia, saveSection, sectionOp, uploadMedia, type SaveResult } from "./site-actions";
import type { FrameMessage, LiveState } from "./live-preview";
import { addPageFields, pageFields } from "./page-fields";
import { shrink } from "./shrink-image";
import { UndoNotice, type UndoState } from "./undo-notice";

type Data = Record<string, unknown>;

const MUTED = "text-[var(--ds-on-surface-muted)]";
const KICKER = `font-mono text-[11px] uppercase tracking-[0.05em] ${MUTED}`;

// ---------- photos ----------

async function upload(file: File): Promise<string | null> {
  const fd = new FormData();
  fd.set("file", await shrink(file));
  const r = await uploadMedia(fd);
  if (r.ok) return (r.data as { url: string }).url;
  toast(r.error, "danger");
  return null;
}

/** A button that opens the file picker and hands back the uploaded file links. */
function UploadButton({ label, multiple, accept = "image/png,image/jpeg,image/webp", raw, onDone }: { label: string; multiple?: boolean; accept?: string; raw?: boolean; onDone: (urls: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input ref={input} type="file" accept={accept} multiple={multiple} hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (!files.length) return;
          setBusy(true);
          const urls: string[] = [];
          for (const f of files) {
            const u = raw ? await uploadRaw(f) : await upload(f);
            if (u) urls.push(u);
          }
          setBusy(false);
          if (urls.length) onDone(urls);
        }} />
      <Button type="button" size="sm" variant="secondary" className="rounded-full" isLoading={busy} onClick={() => input.current?.click()}>{label}</Button>
    </>
  );
}

/** A PDF goes up as it is. */
async function uploadRaw(file: File): Promise<string | null> {
  const fd = new FormData();
  fd.set("file", file);
  const r = await uploadMedia(fd);
  if (r.ok) return (r.data as { url: string }).url;
  toast(r.error, "danger");
  return null;
}

interface LibItem { id: string; url: string; viewUrl: string; fileName: string; alt: string | null; places: { where: string }[] }
/** Every photo this school has uploaded for its website. Pick one. Removing is done under Media, where it says where a photo is used. */
function PhotoLibrary({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (url: string) => void }) {
  const [photos, setPhotos] = useState<LibItem[] | null>(null);
  const load = useCallback(() => { const fd = new FormData(); fd.set("kind", "photo"); void listMedia(fd).then((r) => setPhotos(r.ok ? (r.data as LibItem[]) : [])); }, []);
  useEffect(() => { if (open) load(); }, [open, load]);
  const remove = async (p: LibItem) => {
    if (!window.confirm("Delete this photo for good? It is refused while your live website uses it.")) return;
    const fd = new FormData(); fd.set("id", p.id);
    const r = await removeMedia(fd);
    if (r.ok) load(); else toast(r.error, "danger");
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} size="lg" title="Your photos" description="Photos you have uploaded for the website. Click one to use it.">
      <div className="mb-4 flex flex-wrap items-center gap-3"><UploadButton label="Upload photos" multiple onDone={load} /><Link href="/app/website/media" className="text-sm text-[var(--ds-primary-text)] hover:underline">Manage photos and descriptions</Link></div>
      {photos === null ? <p className={cn("text-sm", MUTED)}>Loading your photos...</p>
        : photos.length === 0 ? <p className={cn("text-sm", MUTED)}>No photos yet. Upload a few from your computer or phone.</p>
          : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {photos.map((p) => (
                <li key={p.id} className="group relative">
                  <button type="button" onClick={() => { onPick(p.url); onOpenChange(false); }} className="block w-full overflow-hidden rounded-2xl bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
                    <img src={p.viewUrl} alt={p.alt ?? ""} loading="lazy" className="aspect-[4/3] w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]" />
                    {!p.alt ? <span className="block truncate px-2 py-1 text-left text-[11px] text-[var(--ds-on-surface-muted)]">{p.fileName}</span> : null}
                  </button>
                  <button type="button" onClick={() => remove(p)} aria-label={`Delete ${p.fileName}`} title="Delete photo"
                    className="absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100">
                    <IconTrash className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
    </Modal>
  );
}

function ImageField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [library, setLibrary] = useState(false);
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-[72px] w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/[0.05]">
        {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : <IconPhoto className={cn("h-6 w-6", MUTED)} aria-hidden />}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <UploadButton label={value ? "Replace" : "Upload"} onDone={([u]) => u && onChange(u)} />
          <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={() => setLibrary(true)}>Your photos</Button>
          {value ? <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={() => onChange("")}>Remove</Button> : null}
        </div>
        <input id={id} className={cn(INPUT, "h-9 text-xs")} value={value} onChange={(e) => onChange(e.target.value)} placeholder="or paste a photo link (https://...)" />
      </div>
      <PhotoLibrary open={library} onOpenChange={setLibrary} onPick={onChange} />
    </div>
  );
}

// ---------- the form of one section ----------

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className={cn("inline-flex h-10 w-10 items-center justify-center rounded-full transition-colors sm:h-8 sm:w-8 hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] disabled:pointer-events-none disabled:opacity-30", MUTED)}>
      {children}
    </button>
  );
}

function ListField({ f, value, onChange }: { f: EditField; value: unknown; onChange: (v: Data[]) => void }) {
  const rows = Array.isArray(value) ? (value as Data[]) : [];
  const max = f.max ?? 50;
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const n = [...rows]; [n[i], n[j]] = [n[j]!, n[i]!];
    onChange(n);
  };
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <div key={i} className="rounded-2xl bg-white/[0.04] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className={KICKER}>{f.itemLabel} {i + 1}</span>
            <span className="flex">
              <IconBtn label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><IconArrowUp className="h-4 w-4" aria-hidden /></IconBtn>
              <IconBtn label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}><IconArrowDown className="h-4 w-4" aria-hidden /></IconBtn>
              <IconBtn label={`Remove ${f.itemLabel} ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}><IconTrash className="h-4 w-4" aria-hidden /></IconBtn>
            </span>
          </div>
          <Fields fields={f.item ?? []} data={r} onChange={(k, v) => onChange(rows.map((x, j) => (j === i ? { ...x, [k]: v } : x)))} />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" className="rounded-full" disabled={rows.length >= max} onClick={() => onChange([...rows, {}])}>
          <IconPlus className="mr-1 h-3.5 w-3.5" aria-hidden />Add {f.itemLabel}
        </Button>
        {f.bulk && rows.length < max ? <UploadButton label="Upload photos" multiple onDone={(urls) => onChange([...rows, ...urls.map((u) => ({ [f.bulk!]: u }))].slice(0, max))} /> : null}
        <span className={cn("text-xs", MUTED)}>{rows.length} of {max}</span>
      </div>
    </div>
  );
}

/** The cells of a table: one input per column, named by the column titles typed above. */
function RowsField({ columns, value, onChange }: { columns: string[]; value: unknown; onChange: (v: string[][]) => void }) {
  const cols = columns.filter((c) => c.trim());
  const n = Math.max(cols.length, 2);
  const rows = Array.isArray(value) ? (value as string[][]) : [];
  const grid = { gridTemplateColumns: `repeat(${n}, minmax(110px, 1fr)) 32px` };
  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-x-auto pb-1">
        <div className="grid min-w-max gap-1.5" style={grid}>
          {Array.from({ length: n }, (_, j) => <span key={j} className={cn(KICKER, "truncate px-1")}>{cols[j] ?? `Column ${j + 1}`}</span>)}<span />
        </div>
        {rows.map((r, i) => (
          <div key={i} className="mt-1.5 grid min-w-max items-center gap-1.5" style={grid}>
            {Array.from({ length: n }, (_, j) => (
              <input key={j} aria-label={`${cols[j] ?? `Column ${j + 1}`}, row ${i + 1}`} className={cn(INPUT, "h-9 text-xs")} value={r[j] ?? ""}
                onChange={(e) => onChange(rows.map((x, k) => (k === i ? Array.from({ length: n }, (_, c) => (c === j ? e.target.value : x[c] ?? "")) : x)))} />
            ))}
            <IconBtn label={`Remove row ${i + 1}`} onClick={() => onChange(rows.filter((_, k) => k !== i))}><IconTrash className="h-4 w-4" aria-hidden /></IconBtn>
          </div>
        ))}
      </div>
      <div><Button type="button" size="sm" variant="secondary" className="rounded-full" onClick={() => onChange([...rows, Array.from({ length: n }, () => "")])}><IconPlus className="mr-1 h-3.5 w-3.5" aria-hidden />Add row</Button></div>
    </div>
  );
}

/** A document: upload a PDF, or paste a link. */
function FileField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <UploadButton label={value ? "Replace file" : "Upload a PDF"} accept="application/pdf" raw onDone={([u]) => u && onChange(u)} />
        {value ? <a href={value} target="_blank" rel="noopener" className="text-sm text-[var(--ds-primary-text)] hover:underline">Open file</a> : null}
        {value ? <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={() => onChange("")}>Remove</Button> : null}
      </div>
      <input id={id} className={cn(INPUT, "h-9 text-xs")} value={value} onChange={(e) => onChange(e.target.value)} placeholder="or paste a link (https://...)" />
    </div>
  );
}

function Fields({ fields, data, onChange, errors = {} }: { fields: EditField[]; data: Data; onChange: (name: string, value: unknown) => void; errors?: Record<string, string> }) {
  const uid = useRef(`f${Math.random().toString(36).slice(2, 8)}`).current;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const id = `${uid}-${f.name}`;
        const v = data[f.name];
        const text = v == null ? "" : String(v);
        const common = { id, value: text, placeholder: f.placeholder, "aria-invalid": errors[f.name] ? true : undefined, onChange: (e: { target: { value: string } }) => onChange(f.name, e.target.value) };
        let control: ReactNode;
        switch (f.kind) {
          case "textarea": control = <textarea {...common} rows={4} className={cn(INPUT, "h-auto py-2")} />; break;
          case "select": control = <select {...common} className={INPUT}>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>; break;
          case "image": control = <ImageField id={id} value={text} onChange={(u) => onChange(f.name, u)} />; break;
          case "file": control = <FileField id={id} value={text} onChange={(u) => onChange(f.name, u)} />; break;
          case "lines": control = <textarea id={id} rows={4} className={cn(INPUT, "h-auto py-2")} value={Array.isArray(v) ? v.join("\n") : ""} onChange={(e) => onChange(f.name, e.target.value.split("\n"))} />; break;
          case "list": control = <ListField f={f} value={v} onChange={(rows) => onChange(f.name, rows)} />; break;
          case "rows": control = <RowsField columns={Array.isArray(data.columns) ? (data.columns as string[]) : []} value={v} onChange={(rows) => onChange(f.name, rows)} />; break;
          default: control = <input {...common} type={f.kind ?? "text"} className={INPUT} />;
        }
        return <ModalField key={f.name} label={f.label} htmlFor={id} required={f.required} hint={f.hint} error={errors[f.name]} className={f.half ? undefined : "sm:col-span-2"}>{control}</ModalField>;
      })}
    </div>
  );
}

/** What goes to the server: empty list rows and blank lines dropped, table rows squared to the column count. */
function clean(fields: EditField[], data: Data): Data {
  const out: Data = { ...data };
  for (const f of fields) {
    const v = Array.isArray(out[f.name]) ? (out[f.name] as unknown[]) : [];
    if (f.kind === "lines") out[f.name] = v.map((x) => String(x).trim()).filter(Boolean);
    if (f.kind === "list") out[f.name] = v.filter((r) => Object.values(r as Data).some((x) => String(x ?? "").trim()));
    if (f.kind === "rows") {
      const n = Math.max((out.columns as string[] | undefined)?.length ?? 0, 2);
      out[f.name] = (v as string[][]).map((r) => Array.from({ length: n }, (_, i) => String(r[i] ?? "").trim())).filter((r) => r.some(Boolean));
    }
  }
  return out;
}

/** One line saying what a section holds. */
function summary(s: Section): string {
  const n = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;
  switch (s.type) {
    case "hero": case "cta": case "admission_form": return s.data.heading;
    case "rich_text": case "image_text": return s.data.heading ?? s.data.body.slice(0, 70);
    case "stats": return s.data.items.map((i) => `${i.value} ${i.label}`).join(", ");
    case "gallery": return n(s.data.images.length, "photo");
    case "news": case "events": case "staff": return `${s.data.heading}, up to ${s.data.limit}`;
    case "testimonials": return n(s.data.items.length, "quote");
    case "contact": return s.data.address;
    case "features": return s.data.heading ?? n(s.data.items.length, "point");
    case "steps": return s.data.heading ?? n(s.data.items.length, "step");
    case "faq": return s.data.heading ?? n(s.data.items.length, "question");
    case "table": return s.data.heading ?? n(s.data.rows.length, "row");
    case "links": return s.data.heading ?? n(s.data.items.length, "link");
    case "video": return s.data.title;
    case "documents": return s.data.heading ?? n(s.data.items.length, "document");
    case "people": return s.data.heading ?? n(s.data.items.length, "person");
    case "achievers": return s.data.heading ?? n(s.data.items.length, "name");
    case "contact_form": return s.data.heading;
    case "disclosure": return "Filled in under Website, Disclosure";
  }
}

// ---------- the preview frame ----------

type Device = "desktop" | "tablet" | "phone";
const DEVICE_WIDTH: Record<Device, number> = { desktop: 1280, tablet: 768, phone: 390 };
function Preview({ state, device, onNav, onSelect }: { state: LiveState; device: Device; onNav: (slug: string) => void; onSelect: (id: string) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef({ state, onNav, onSelect });
  const [width, setWidth] = useState(0);

  const send = useCallback(() => {
    const msg: FrameMessage = { smw: "site", ...latest.current.state };
    frame.current?.contentWindow?.postMessage(msg, window.location.origin);
  }, []);
  useEffect(() => { latest.current = { state, onNav, onSelect }; send(); }, [state, onNav, onSelect, send]);
  useEffect(() => {
    const on = (e: MessageEvent<FrameMessage>) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      if (e.data.smw === "ready") send();
      else if (e.data.smw === "nav") latest.current.onNav(e.data.slug);
      else if (e.data.smw === "select") latest.current.onSelect(e.data.id);
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [send]);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  // The frame is laid out at a real screen width and scaled to fit, so the site's own breakpoints decide the layout.
  const real = DEVICE_WIDTH[device];
  const k = width ? Math.min(1, width / real) : 1;
  return (
    <div ref={box} className={cn("h-full overflow-hidden rounded-2xl", device === "desktop" && "bg-white")}>
      <iframe ref={frame} src="/?preview=1&live=1" title="Website preview" className={device !== "desktop" ? "rounded-[28px] bg-white" : undefined}
        style={{ width: real, height: `${100 / k}%`, border: 0, transform: `scale(${k})`, transformOrigin: "top left", marginLeft: Math.max(0, (width - real * k) / 2) }} />
    </div>
  );
}

// ---------- the editor ----------

export interface SiteEditorProps {
  content: SiteContent;
  template: TemplateKey;
  canManage: boolean;
  initialSlug: string;
  /** Sections that fill themselves from another screen: where to manage what they show. */
  sources: Partial<Record<SectionType, { href: string; label: string }>>;
  /** The signed-in person, and who saved the draft last and when, for the "someone else is editing" hint. */
  meId: string;
  draft: { by: string | null; byId: string | null; at: string | null };
  /** The most pages the plan allows, or null. */
  pageLimit: number | null;
}

interface Editing { id: string; data: Data; dirty: boolean; /** The section as it was when opened. */ hash: string }
interface Conflict { by: string; at: string; theirs: Data; hash: string; mine: boolean }
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" });
const sameJson = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);

export function SiteEditor({ content, template, canManage, initialSlug, sources, meId, draft, pageLimit }: SiteEditorProps) {
  const router = useRouter();
  const [slug, setSlug] = useState(initialSlug);
  const [edit, setEdit] = useState<Editing | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [look, setLook] = useState(template);
  const [device, setDevice] = useState<Device>("desktop");
  const [adding, setAdding] = useState(false);
  const [find, setFind] = useState("");
  const [copying, setCopying] = useState<string | null>(null);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [openNext, setOpenNext] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null);
  const [seen, setSeen] = useState(draft.at);
  const [other, setOther] = useState<{ by: string; at: string } | null>(null);
  const [pending, start] = useTransition();

  const page = content.pages.find((p) => p.slug === slug) ?? content.pages[0]!;
  const editing = edit && page.sections.some((s) => s.id === edit.id) ? edit : null;

  // What the preview draws: the saved draft, with the section being typed laid over it.
  const live = useMemo<SiteContent>(() => (!editing ? content : {
    ...content,
    pages: content.pages.map((p) => (p.slug !== page.slug ? p : { ...p, sections: p.sections.map((s) => (s.id === editing.id ? ({ ...s, data: editing.data } as Section) : s)) })),
  }), [content, editing, page.slug]);
  const state = useMemo<LiveState>(() => ({ content: live, slug: page.slug, template: look, focus: editing?.id }), [live, page.slug, look, editing?.id]);

  const leave = useCallback(() => !edit?.dirty || window.confirm("Discard your unsaved changes to this section?"), [edit?.dirty]);
  const open = useCallback((id: string) => {
    if (!canManage || id === edit?.id) return;
    const s = page.sections.find((x) => x.id === id);
    if (!s || !leave()) return;
    setEdit({ id, data: structuredClone(s.data) as Data, dirty: false, hash: sectionHash(s) });
    setErrors({}); setConflict(null);
  }, [canManage, edit?.id, page.sections, leave]);
  const close = () => { if (leave()) { setEdit(null); setErrors({}); setConflict(null); } };
  const goPage = useCallback((to: string) => {
    if (to === page.slug || !content.pages.some((p) => p.slug === to) || !leave()) return;
    setEdit(null); setErrors({}); setConflict(null); setSlug(to);
    window.history.replaceState(null, "", `?page=${to}`);
  }, [content.pages, page.slug, leave]);

  // A section that was just added opens as soon as the refreshed draft holds it.
  useEffect(() => {
    if (openNext && page.sections.some((s) => s.id === openNext)) { setOpenNext(null); open(openNext); }
  }, [openNext, page.sections, open]);

  // Unsaved words are not lost to a closed tab.
  useEffect(() => {
    if (!edit?.dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [edit?.dirty]);

  // Somebody else saving the draft is noticed within half a minute.
  useEffect(() => {
    if (!canManage) return;
    const t = setInterval(() => {
      if (document.hidden) return;
      void draftInfo().then((r) => {
        if (!r.ok || !r.data.at) return;
        const d = r.data as { at: string; by: string | null; byId: string | null };
        setOther(d.byId !== meId && (!seen || d.at > seen) ? { by: d.by ?? "Someone", at: d.at } : null);
      });
    }, 25_000);
    return () => clearInterval(t);
  }, [canManage, meId, seen]);
  useEffect(() => { setSeen(draft.at); setOther(null); }, [draft.at]);

  const act = (action: (fd: FormData) => Promise<{ ok: boolean; error?: string; data?: unknown }>, values: Record<string, string>, done?: (data: unknown) => void) => start(async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    const r = await action(fd);
    if (r.ok) { done?.(r.data); router.refresh(); } else toast(r.error ?? "Something went wrong.", "danger");
  });
  const op = (o: string, values: Record<string, string> = {}, done?: (data: unknown) => void) => act(sectionOp, { op: o, slug: page.slug, ...values }, done);

  const afterSave = (r: SaveResult, data: Data, id: string) => {
    if (r.saved) { setEdit({ id, data, dirty: false, hash: r.hash }); setErrors({}); setConflict(null); toast("Saved to the draft. Publish to go live."); router.refresh(); }
    else setConflict(r.conflict as Conflict);
  };
  const save = (force = false) => {
    const s = page.sections.find((x) => x.id === editing?.id);
    if (!s || !editing) return;
    start(async () => {
      const data = clean(EDITOR_FIELDS[s.type], editing.data);
      const fd = new FormData();
      fd.set("slug", page.slug); fd.set("id", s.id); fd.set("data", JSON.stringify(data)); fd.set("hash", editing.hash);
      if (force) fd.set("force", "1");
      const r = await saveSection(fd);
      if (r.ok) afterSave(r.data, data, s.id);
      else { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); }
    });
  };
  const takeTheirs = () => {
    if (!conflict || !editing) return;
    setEdit({ id: editing.id, data: structuredClone(conflict.theirs), dirty: false, hash: conflict.hash });
    setConflict(null); toast("You are now looking at their version."); router.refresh();
  };
  /** Fields whose words differ between the two versions, by the labels the editor shows. */
  const differing = (s: Section) => {
    if (!conflict || !editing) return [];
    const mine = clean(EDITOR_FIELDS[s.type], editing.data);
    return EDITOR_FIELDS[s.type].filter((f) => !sameJson(mine[f.name] ?? null, conflict.theirs[f.name] ?? null)).map((f) => f.label);
  };

  const add = (type: SectionType) => start(async () => {
    const fd = new FormData();
    fd.set("slug", page.slug); fd.set("type", type);
    const r = await addSectionAt(fd);
    setAdding(false);
    if (!r.ok) { toast(r.error, "danger"); return; }
    setOpenNext(r.data.id);
    router.refresh();
  });

  const remove = (s: Section) => act(sectionOp, { op: "remove", slug: page.slug, id: s.id }, (d) => {
    const x = d as { removed: Section | null; index: number };
    if (!x.removed) return;
    setUndo({ text: `${SECTION_META[s.type].label} removed.`, until: Date.now() + 30_000, run: async () => {
      const fd = new FormData();
      fd.set("op", "restore"); fd.set("slug", page.slug); fd.set("section", JSON.stringify(x.removed)); fd.set("index", String(x.index));
      const r = await sectionOp(fd);
      if (r.ok) router.refresh(); else toast(r.error, "danger");
    } });
  });

  const dropOn = (targetId: string) => {
    const d = drag;
    setDrag(null);
    if (!d || d.id === targetId) return;
    const to = page.sections.findIndex((x) => x.id === targetId);
    if (to >= 0) op("moveTo", { id: d.id, index: String(to) });
  };

  const shown = SECTION_TYPES.filter((t) => `${SECTION_META[t].label} ${SECTION_META[t].description}`.toLowerCase().includes(find.trim().toLowerCase()));
  const others = content.pages.filter((p) => p.slug !== page.slug);
  const recent = draft.by && draft.byId !== meId && draft.at && Date.now() - new Date(draft.at).getTime() < 10 * 60_000;
  const chip = "min-h-9 rounded-full px-3.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";
  const DEVICES: { id: Device; label: string; icon: ReactNode }[] = [
    { id: "desktop", label: "Computer view", icon: <IconDeviceDesktop className={cn("h-4 w-4", device === "desktop" && "text-[var(--ds-primary-text)]")} aria-hidden /> },
    { id: "tablet", label: "Tablet view", icon: <IconDeviceTablet className={cn("h-4 w-4", device === "tablet" && "text-[var(--ds-primary-text)]")} aria-hidden /> },
    { id: "phone", label: "Phone view", icon: <IconDeviceMobile className={cn("h-4 w-4", device === "phone" && "text-[var(--ds-primary-text)]")} aria-hidden /> },
  ];
  return (
    <div className="grid gap-4 pb-8 xl:grid-cols-[minmax(0,480px)_minmax(0,1fr)]">
      {other ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/[0.07] px-4 py-3 text-sm xl:col-span-2">
          <span className="min-w-0 flex-1">{other.by} saved changes to the draft at {time(other.at)}. You are looking at an older copy.</span>
          <Button type="button" size="sm" className="rounded-full" onClick={() => { if (leave()) { setEdit(null); setOther(null); router.refresh(); } }}>Load their changes</Button>
        </div>
      ) : recent ? <p className={cn("rounded-2xl bg-white/[0.04] px-4 py-3 text-sm xl:col-span-2", MUTED)}>{draft.by} saved this draft at {time(draft.at!)}. If you both edit the same section, the second save asks which version to keep.</p> : null}
      {/* Below the two-column width the editor and the preview share the screen, one at a time. */}
      <div role="tablist" aria-label="Editor or preview" className="flex gap-1 rounded-full bg-white/[0.05] p-1 xl:hidden">
        {(["edit", "preview"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cn(chip, "flex-1", tab === t ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary)]" : "hover:bg-white/[0.06]")}>{t === "edit" ? "Edit" : "Preview"}</button>
        ))}
      </div>
      <div className={cn("min-w-0 flex-col gap-3", tab === "edit" ? "flex" : "hidden xl:flex")}>
        <Panel title="Pages" className="h-auto"
          action={canManage ? (pageLimit != null && content.pages.length >= pageLimit
            ? <span className={cn("text-xs", MUTED)}>Plan limit of {pageLimit} pages. <Link href="/app/billing" className="text-[var(--ds-primary-text)] underline underline-offset-2">See plans</Link></span>
            : <FormModal title="Add page" description="Start from a ready-made page, then change anything." icon="web" fields={addPageFields} action={addPage} submitLabel="Add page" trigger={{ label: "Add page", variant: "secondary", size: "sm", plus: true }} />) : null}>
          <div className="flex flex-wrap gap-2">
            {content.pages.map((p) => (
              <button key={p.slug} type="button" aria-pressed={p.slug === page.slug} onClick={() => goPage(p.slug)}
                className={cn(chip, p.slug === page.slug ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary)]" : "bg-white/[0.05] hover:bg-white/[0.09]")}>{p.title}{p.hidden ? " (hidden)" : ""}</button>
            ))}
          </div>
          <p className={cn("mt-3 text-xs", MUTED)}>Rename an address, hide a page or change the menu under <Link href="/app/website/pages" className="text-[var(--ds-primary-text)] underline underline-offset-2">Pages and menu</Link>.</p>
        </Panel>

        <Panel title={page.title} className="h-auto"
          action={canManage ? <FormModal key={page.slug} title="Page settings" icon="web" fields={pageFields} action={updatePage} hidden={{ slug: page.slug }}
            values={{ title: page.title, intro: page.intro, seoTitle: page.seo.title, seoDescription: page.seo.description, seoImageUrl: page.seo.imageUrl }} trigger={{ label: "Page settings", variant: "secondary", size: "sm" }} /> : null}>
          <p className={cn("-mt-2 mb-3 text-xs", MUTED)}>{page.slug === HOME_SLUG ? "Your home page" : `yourschool/${page.slug}`}{page.hidden ? ". Hidden: visitors cannot open it" : ""}. Click a section here or in the preview to edit it.</p>
          {page.sections.length === 0 ? <p className={cn("rounded-2xl bg-white/[0.035] p-4 text-sm", MUTED)}>This page has no sections yet. Add a hero, some text or an enquiry form to get started.</p> : (
            <ol className="flex flex-col gap-2">
              {page.sections.map((s, i) => {
                const on = editing?.id === s.id;
                const meta = SECTION_META[s.type];
                return (
                  <li key={s.id} draggable={canManage && !on} onDragStart={() => setDrag({ id: s.id, over: null })} onDragEnd={() => setDrag(null)}
                    onDragOver={(e) => { if (drag) { e.preventDefault(); if (drag.over !== s.id) setDrag({ ...drag, over: s.id }); } }} onDrop={(e) => { e.preventDefault(); dropOn(s.id); }}
                    className={cn("rounded-2xl transition-colors", on ? "bg-white/[0.07]" : "bg-white/[0.035] hover:bg-white/[0.05]", drag?.over === s.id && drag.id !== s.id && "outline outline-2 outline-[var(--ds-primary)]", drag?.id === s.id && "opacity-50")}>
                    <div className="flex items-center gap-1 p-2 pl-2">
                      {canManage ? <span aria-hidden title="Drag to move" className={cn("hidden h-8 w-6 shrink-0 cursor-grab items-center justify-center sm:inline-flex", MUTED)}><IconGripVertical className="h-4 w-4" /></span> : <span className="w-2" />}
                      <button type="button" aria-expanded={on} onClick={() => (on ? close() : open(s.id))} className="min-w-0 flex-1 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
                        <span className="flex items-center gap-2 text-sm font-medium">{meta.label}{s.hidden ? <span className="inline-flex items-center gap-1"><IconEyeOff className="h-3.5 w-3.5" aria-hidden /><ToneBadge label="Hidden" tone="warning" /></span> : null}</span>
                        <span className={cn("block truncate text-xs", MUTED)}>{summary(s)}</span>
                      </button>
                      {canManage ? <>
                        <IconBtn label="Move up" disabled={i === 0 || pending} onClick={() => op("move", { id: s.id, dir: "up" })}><IconArrowUp className="h-4 w-4" aria-hidden /></IconBtn>
                        <IconBtn label="Move down" disabled={i === page.sections.length - 1 || pending} onClick={() => op("move", { id: s.id, dir: "down" })}><IconArrowDown className="h-4 w-4" aria-hidden /></IconBtn>
                        <MoreMenu iconOnly label={`More for ${meta.label}`}>
                          <MenuItem onClick={() => op("duplicate", { id: s.id })}>Duplicate</MenuItem>
                          <MenuItem onClick={() => op(s.hidden ? "show" : "hide", { id: s.id })}>{s.hidden ? "Show on the site" : "Hide from the site"}</MenuItem>
                          {others.length ? <MenuItem onClick={() => setCopying(s.id)}>Copy to another page</MenuItem> : null}
                          <MenuItem tone="danger" onClick={() => remove(s)}>Remove</MenuItem>
                        </MoreMenu>
                      </> : null}
                    </div>
                    {on && editing ? (
                      <div className="px-4 pb-4">
                        <p className={cn("mb-4 text-xs", MUTED)}>
                          {meta.description}{" "}
                          {sources[s.type] ? <a href={sources[s.type]!.href} className="text-[var(--ds-primary-text)] hover:underline">{sources[s.type]!.label}</a> : null}
                          {s.type === "disclosure" ? <Link href="/app/website/disclosure" className="text-[var(--ds-primary-text)] hover:underline">Fill the rows under Disclosure.</Link> : null}
                        </p>
                        {conflict ? (
                          <div role="alert" className="mb-4 rounded-2xl bg-[var(--ds-color-warning-500)]/15 p-4 text-sm">
                            <p className="font-medium">{conflict.mine ? "You" : conflict.by} changed this section at {time(conflict.at)}, after you opened it.</p>
                            <p className={cn("mt-1 text-xs", MUTED)}>{differing(s).length ? `Different: ${differing(s).join(", ")}.` : "The words are the same, but something else differs."} Nothing of yours is lost yet: it is still in the form.</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button type="button" size="sm" className="rounded-full" isLoading={pending} onClick={() => save(true)}>Keep mine</Button>
                              <Button type="button" size="sm" variant="secondary" className="rounded-full" onClick={takeTheirs}>Take theirs</Button>
                            </div>
                          </div>
                        ) : null}
                        <Fields fields={EDITOR_FIELDS[s.type]} data={editing.data} errors={errors}
                          onChange={(k, v) => setEdit((e) => (e ? { ...e, data: { ...e.data, [k]: v }, dirty: true } : e))} />
                        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
                          <span className={cn("text-xs", MUTED)}>{editing.dirty ? "Showing in the preview. Not saved yet." : "Saved to the draft."}</span>
                          <span className="flex gap-2">
                            <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={close}>Close</Button>
                            <Button type="button" size="sm" className="rounded-full" isLoading={pending} disabled={!editing.dirty || !!conflict} onClick={() => save()}>Save</Button>
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
          {canManage ? <div className="mt-4"><Button type="button" variant="secondary" className="rounded-full" onClick={() => setAdding(true)}><IconPlus className="mr-1.5 h-4 w-4" aria-hidden />Add section</Button></div> : null}
        </Panel>

        <Panel title="Design" className="h-auto"
          action={canManage && look !== template ? <ActionButton variant="default" label="Use this design" action={setTemplate} values={{ template: look }} successMessage={`${TEMPLATES[look].name} saved to the draft. Publish to go live.`} /> : null}>
          <div role="radiogroup" aria-label="Website design" className="grid gap-2 sm:grid-cols-2">
            {TEMPLATE_KEYS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={look === k} onClick={() => setLook(k)}
                className={cn("rounded-2xl p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]", look === k ? "bg-white/[0.12]" : "bg-white/[0.04] hover:bg-white/[0.08]")}>
                <span className="flex items-center justify-between gap-2 text-sm font-medium">{TEMPLATES[k].name}{k === template ? <span className={KICKER}>In use</span> : null}</span>
                <span className={cn("mt-1 block text-xs", MUTED)}>{TEMPLATES[k].description}</span>
              </button>
            ))}
          </div>
          <p className={cn("mt-3 text-xs", MUTED)}>Click a design to see your own pages in it. Your words and photos stay the same.</p>
          {canManage ? (
            <div className="mt-3">
              <ActionButton variant="ghost" label={`Start again with ${TEMPLATES[look].name} sample pages`} action={setTemplate} values={{ template: look, starter: "1" }}
                successMessage={`Your draft now holds the ${TEMPLATES[look].name} sample site. Change the words and photos, then publish.`}
                confirm={{ title: `Replace your pages with the ${TEMPLATES[look].name} sample site?`, body: "Every page in your draft is replaced by the long sample pages written for this design, with sample photos. Your live site stays as it is until you publish. Your earlier published versions stay under Versions.", confirmLabel: "Replace my draft", danger: true }} />
            </div>
          ) : null}
        </Panel>
      </div>

      <div className={cn("min-w-0", tab === "preview" ? "block" : "hidden xl:block")}>
        {/* top-20: the panel's own header bar is sticky and 4rem tall. */}
        <div className="sticky top-20 flex h-[calc(100dvh-10rem)] flex-col gap-3 rounded-3xl bg-[var(--ds-surface-container-low)] p-3 xl:h-[calc(100dvh-6rem)]">
          <div className="flex items-center justify-between gap-2 pl-3">
            <span className="min-w-0 truncate text-sm">Preview <span className={MUTED}>{page.title}, {TEMPLATES[look].name}{look !== template ? " (not saved)" : ""}</span></span>
            <span className="flex items-center">
              {DEVICES.map((d) => <IconBtn key={d.id} label={d.label} onClick={() => setDevice(d.id)}>{d.icon}</IconBtn>)}
              <a href={`${page.slug === HOME_SLUG ? "/" : `/${page.slug}`}?preview=1`} target="_blank" rel="noopener" aria-label="Open the saved draft in a new tab" title="Open the saved draft in a new tab"
                className={cn("inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/[0.08]", MUTED)}><IconExternalLink className="h-4 w-4" aria-hidden /></a>
            </span>
          </div>
          <div className="min-h-0 flex-1"><Preview state={state} device={device} onNav={goPage} onSelect={open} /></div>
        </div>
      </div>

      <Modal open={adding} onOpenChange={(o) => { setAdding(o); if (!o) setFind(""); }} size="lg" title="Add a section" description={`It goes to the end of ${page.title}. You can move it after.`}>
        <label className="relative mb-3 block">
          <span className="sr-only">Search section types</span>
          <IconSearch className={cn("pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", MUTED)} aria-hidden />
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search: photos, fees, form..." className={cn(INPUT, "pl-9")} />
        </label>
        {shown.length === 0 ? <p className={cn("text-sm", MUTED)}>No section matches &quot;{find}&quot;.</p> : (
          <div className="grid gap-2 sm:grid-cols-2">
            {shown.map((t) => {
              const sample = (SECTION_META[t].initial as { heading?: string; title?: string }).heading ?? (SECTION_META[t].initial as { title?: string }).title;
              return (
                <button key={t} type="button" disabled={pending} onClick={() => add(t)}
                  className="rounded-2xl bg-white/[0.04] p-4 text-left transition-colors hover:bg-white/[0.09] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] disabled:opacity-50">
                  <span className="block text-sm font-medium">{SECTION_META[t].label}</span>
                  <span className={cn("mt-1 block text-xs", MUTED)}>{SECTION_META[t].description}</span>
                  {sample ? <span className="mt-3 block rounded-xl bg-white/[0.05] px-3 py-2 text-xs"><span className={KICKER}>Starts as</span><span className="mt-0.5 block truncate">{sample}</span></span> : null}
                </button>
              );
            })}
          </div>
        )}
      </Modal>

      <Modal open={!!copying} onOpenChange={(o) => { if (!o) setCopying(null); }} size="sm" title="Copy to another page" description="A copy goes to the end of that page. The original stays here.">
        <ul className="flex flex-col gap-1">
          {others.map((p) => (
            <li key={p.slug}><button type="button" className="min-h-11 w-full rounded-xl px-3 text-left text-sm hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]"
              onClick={() => { const id = copying!; setCopying(null); op("copy", { id, to: p.slug }, () => toast(`Copied to ${p.title}`)); }}>{p.title}</button></li>
          ))}
        </ul>
      </Modal>
      <UndoNotice undo={undo} onDone={() => setUndo(null)} />
    </div>
  );
}
