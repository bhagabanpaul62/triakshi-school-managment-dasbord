"use client";

import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { IconArrowDown, IconArrowUp, IconFile, IconPaperclip, IconX } from "@tabler/icons-react";
import { cn } from "../../lib/utils";
import { FOCUS, ICON_BTN } from "../finance/ui";
import { fileKind, fileSize } from "./file-utils";
import type { FileItem } from "./FileList";

export interface FilesFieldProps {
  /** Name of the hidden multi-file input the form submits. */
  name?: string;
  label?: string;
  /** Allowed types: MIME ("image/*", "application/pdf") or extensions (".docx"). Empty allows anything. */
  accept?: string[];
  /** Counts files already saved plus new ones. */
  maxCount?: number;
  maxMb?: number;
  /** Files already saved on the record. Removing one adds its id to the hidden inputs named `removeIdsName` (one input per id). */
  existing?: FileItem[];
  removeIdsName?: string;
  disabled?: boolean;
}

type Picked = { key: number; file: File; preview: string | null };

const allowed = (f: File, accept: string[]) =>
  accept.length === 0 || accept.some((a) => (a.startsWith(".") ? f.name.toLowerCase().endsWith(a.toLowerCase()) : a.endsWith("/*") ? f.type.startsWith(a.slice(0, -1)) : f.type === a));

const WORDS: Record<string, string> = { "image/*": "pictures", "application/pdf": "PDF", ".pdf": "PDF" };

/** Pick or drop several files. Limits are checked before upload; the files live in a hidden multi-file input so a normal form submits them in order. */
export function FilesField({ name = "files", label = "Attachments", accept = [], maxCount = 5, maxMb = 10, existing = [], removeIdsName = "removeIds", disabled }: FilesFieldProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const [items, setItems] = useState<Picked[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const live = useRef<Picked[]>([]);
  live.current = items;

  // The hidden input is the source of truth for the form: rebuild it whenever the list changes.
  useEffect(() => {
    const dt = new DataTransfer();
    items.forEach((i) => dt.items.add(i.file));
    if (input.current) input.current.files = dt.files;
  }, [items]);
  useEffect(() => () => live.current.forEach((i) => i.preview && URL.revokeObjectURL(i.preview)), []);

  const kept = existing.filter((f) => !removed.includes(f.id));
  const room = maxCount - kept.length - items.length;
  const acceptWords = [...new Set(accept.map((a) => WORDS[a] ?? a.replace(/^\./, "").toUpperCase()))].join(", ");

  const add = (list: FileList | File[]) => {
    const issues: string[] = [];
    const next: Picked[] = [];
    let slots = room;
    for (const file of Array.from(list)) {
      if (!allowed(file, accept)) issues.push(`"${file.name}" is not an allowed type. You can add: ${acceptWords}.`);
      else if (file.size > maxMb * 1048576) issues.push(`"${file.name}" is ${fileSize(file.size)}. Each file can be up to ${maxMb} MB.`);
      else if (file.size === 0) issues.push(`"${file.name}" is empty.`);
      else if (items.some((i) => i.file.name === file.name && i.file.size === file.size)) issues.push(`"${file.name}" is already added.`);
      else if (slots <= 0) issues.push(`"${file.name}" was not added. You can attach up to ${maxCount} files; remove one to add another.`);
      else { slots--; next.push({ key: ++seq.current, file, preview: fileKind(file.name, file.type) === "image" ? URL.createObjectURL(file) : null }); }
    }
    setProblems(issues);
    if (next.length) setItems((p) => [...p, ...next]);
  };
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (!disabled) add(e.dataTransfer.files); };
  const remove = (key: number) => setItems((p) => { const gone = p.find((i) => i.key === key)?.preview; if (gone) URL.revokeObjectURL(gone); return p.filter((i) => i.key !== key); });
  const move = (idx: number, by: -1 | 1) => setItems((p) => { const q = [...p]; [q[idx], q[idx + by]] = [q[idx + by]!, q[idx]!]; return q; });

  return (
    <div className="flex flex-col gap-2">
      <span id={`${id}-l`} className="text-sm font-medium text-[var(--ds-on-surface)]">{label}</span>
      {/* One input per removed id so the server reads them with getAll. */}
      {removed.map((r) => <input key={r} type="hidden" name={removeIdsName} value={r} />)}
      <input ref={input} type="file" name={name} multiple hidden tabIndex={-1} />
      {/* A separate unnamed picker, so a rejected pick never reaches the form. */}
      <input ref={picker} id={id} type="file" multiple hidden tabIndex={-1} accept={accept.join(",") || undefined}
        onChange={(e) => { add(e.currentTarget.files ?? []); e.currentTarget.value = ""; }} />
      <button type="button" disabled={disabled || room <= 0} aria-describedby={`${id}-h`} aria-labelledby={`${id}-l`}
        onClick={() => picker.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
        className={cn("flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-[var(--ds-on-surface-variant)] transition-colors hover:bg-white/[0.07] disabled:opacity-50", FOCUS, over && "bg-white/[0.12]")}>
        <IconPaperclip className="h-4 w-4 shrink-0" aria-hidden />
        <span>{room <= 0 ? "File limit reached" : "Choose files or drop them here"}</span>
      </button>
      <p id={`${id}-h`} className="text-xs text-[var(--ds-on-surface-muted)]">Up to {maxCount} files, {maxMb} MB each{acceptWords ? `. ${acceptWords}.` : "."} {room > 0 ? `${room} more allowed.` : ""}</p>
      {problems.length ? <ul role="alert" className="flex flex-col gap-1 text-xs text-[var(--ds-color-danger-400)]">{problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
      {kept.length + items.length ? (
        <ul className="flex flex-col gap-2">
          {kept.map((f) => (
            <li key={f.id} className="flex min-h-12 items-center gap-3 rounded-xl bg-white/[0.05] p-2">
              <IconFile className="ml-2 h-5 w-5 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm text-[var(--ds-on-surface)]">{f.name}</span><span className="block text-xs text-[var(--ds-on-surface-muted)]">Already attached · {fileSize(f.sizeBytes)}</span></span>
              <button type="button" onClick={() => setRemoved((r) => [...r, f.id])} aria-label={`Remove ${f.name}`} className={ICON_BTN}><IconX className="h-4 w-4" aria-hidden /></button>
            </li>
          ))}
          {items.map((it, idx) => (
            <li key={it.key} className="flex min-h-12 items-center gap-2 rounded-xl bg-white/[0.05] p-2">
              {it.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.preview} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
              ) : <IconFile className="mx-2.5 h-5 w-5 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden />}
              <span className="min-w-0 flex-1"><span className="block truncate text-sm text-[var(--ds-on-surface)]">{it.file.name}</span><span className="block text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{fileSize(it.file.size)}</span></span>
              <button type="button" disabled={idx === 0} onClick={() => move(idx, -1)} aria-label={`Move ${it.file.name} up`} className={cn(ICON_BTN, "h-9 w-9")}><IconArrowUp className="h-4 w-4" aria-hidden /></button>
              <button type="button" disabled={idx === items.length - 1} onClick={() => move(idx, 1)} aria-label={`Move ${it.file.name} down`} className={cn(ICON_BTN, "h-9 w-9")}><IconArrowDown className="h-4 w-4" aria-hidden /></button>
              <button type="button" onClick={() => remove(it.key)} aria-label={`Remove ${it.file.name}`} className={cn(ICON_BTN, "h-9 w-9")}><IconX className="h-4 w-4" aria-hidden /></button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
