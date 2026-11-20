"use client";

import { useState, useTransition } from "react";
import { Modal, ModalFooter } from "@smw/ui/kit/Modal";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { Button } from "@smw/ui/ui/button";

/**
 * Runs a server action and shows one value from its result in a dialog with a Copy button: an access link or a temporary password.
 * The value is only in this dialog's state, so closing it forgets it (the server never stores a temporary password).
 */
export function RevealButton({ label, action, values, valueKey, title, note, confirm }: {
  label: string; action: (fd: FormData) => Promise<FormResult>; values: Record<string, string>;
  /** Which field of the action's `data` to show. */
  valueKey: string; title: string; note: string;
  /** Ask first; the text says what will happen. */
  confirm?: string;
}) {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = () => start(async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    const r = await action(fd);
    if (!r.ok) { toast(r.error, "danger"); setOpen(false); return; }
    setSecret(String((r.data as Record<string, unknown>)[valueKey]));
  });
  const start_ = () => { setSecret(null); setOpen(true); if (!confirm) run(); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(secret ?? ""); toast("Copied"); } catch { toast("Could not copy. Select the text and copy it.", "danger"); }
  };

  return (
    <>
      <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={start_}>{label}</Button>
      <Modal open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSecret(null); }} size="md" title={title} dismissOnOutsideClick={false}
        footer={secret ? <ModalFooter secondary={{ label: "Close", onClick: () => setOpen(false) }} primary={{ label: "Copy", onClick: copy }} />
          : <ModalFooter secondary={{ onClick: () => setOpen(false) }} primary={{ label: pending ? "Working" : "Continue", onClick: run, loading: pending }} />}>
        <div className="flex flex-col gap-3 pt-2">
          {secret ? (
            <>
              <input readOnly value={secret} aria-label={title} onFocus={(e) => e.currentTarget.select()} className={`${INPUT} font-mono`} />
              <p className="text-sm text-[var(--ds-on-surface-muted)]">{note}</p>
            </>
          ) : <p className="text-sm text-[var(--ds-on-surface-variant)]">{confirm ?? "Working…"}</p>}
        </div>
      </Modal>
    </>
  );
}
