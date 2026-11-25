"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { IconSend } from "@tabler/icons-react";
import { cn } from "../../lib/utils";
import { INPUT } from "../../lib/tone";
import { FOCUS, PILL_BTN, PRIMARY_BTN } from "../finance/ui";
import { FilesField, type FilesFieldProps } from "./FilesField";

export interface ComposerProps {
  /** Gets the form: `text`, `clientId` (the same id on every retry of one message, so the server can drop a double send) and any files. */
  send: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Hidden values sent with every message (the thread id). */
  hidden?: Record<string, string>;
  placeholder?: string;
  maxLength?: number;
  /** Turns files on: limits as in FilesField. */
  files?: Omit<FilesFieldProps, "name" | "existing" | "removeIdsName">;
  /** Replaces the box with the reason it is closed and the way forward: "Replies are closed. Ask the school office to reopen." */
  disabled?: { reason: string; action?: { label: string; href: string } };
  /** A line under the box, for example "Will be delivered at 7:00 am". */
  notice?: string;
  /** Slot above the box for saved replies. */
  savedReplies?: ReactNode;
  className?: string;
}

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/** Enter sends, Shift+Enter makes a new line. A failed send keeps the text and offers Retry with the same client id. */
export function Composer({ send, hidden = {}, placeholder = "Write a message", maxLength = 2000, files, disabled, notice, savedReplies, className }: ComposerProps) {
  const form = useRef<HTMLFormElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [clientId, setClientId] = useState(newId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [showFiles, setShowFiles] = useState(false);

  if (disabled) {
    return (
      <div className={cn("flex flex-wrap items-center gap-3 rounded-2xl bg-white/[0.04] p-4 text-sm text-[var(--ds-on-surface-variant)]", className)}>
        <p className="min-w-0 flex-1">{disabled.reason}</p>
        {disabled.action ? <Link href={disabled.action.href} className={PILL_BTN}>{disabled.action.label}</Link> : null}
      </div>
    );
  }

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const f = form.current;
    if (!f || pending) return;
    const fd = new FormData(f);
    if (!text.trim() && !Array.from(fd.getAll("files")).some((x) => x instanceof File && x.size > 0)) return;
    setPending(true);
    setError(null);
    const r = await send(fd).catch(() => ({ ok: false as const, error: "No connection." }));
    setPending(false);
    if (r.ok) { setText(""); setClientId(newId()); setShowFiles(false); requestAnimationFrame(() => area.current?.focus()); } else setError(r.error);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // isComposing: Enter that confirms a Hindi or other IME word must not send.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
  };

  return (
    // Remounting on clientId clears the file list after a successful send.
    <form key={clientId} ref={form} onSubmit={submit} className={cn("flex flex-col gap-2", className)}>
      <input type="hidden" name="clientId" value={clientId} />
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {savedReplies}
      {showFiles && files ? <FilesField {...files} /> : null}
      <div className="flex items-end gap-2">
        <textarea ref={area} name="text" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} rows={1} maxLength={maxLength} placeholder={placeholder} aria-label="Message"
          className={cn(INPUT, "h-auto max-h-40 min-h-11 flex-1 resize-none py-2.5 leading-6 [field-sizing:content]")} />
        {files ? <button type="button" onClick={() => setShowFiles((v) => !v)} aria-pressed={showFiles} className={cn(PILL_BTN, "px-3")}>Files</button> : null}
        <button type="submit" disabled={pending} className={cn(PRIMARY_BTN, "px-4")}><IconSend className="h-4 w-4" aria-hidden /><span className="sr-only sm:not-sr-only">{pending ? "Sending…" : "Send"}</span></button>
      </div>
      {error ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-xs text-[var(--ds-color-danger-400)]">
          Not sent: {error} Your message is kept.
          <button type="button" onClick={() => void submit()} className={cn("rounded-full underline underline-offset-2", FOCUS)}>Retry</button>
        </p>
      ) : notice ? <p className="text-xs text-[var(--ds-on-surface-muted)]">{notice}</p> : <p className="text-xs text-[var(--ds-on-surface-muted)]">Enter sends. Shift+Enter makes a new line.</p>}
    </form>
  );
}
