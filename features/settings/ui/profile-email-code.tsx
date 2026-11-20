"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";

/**
 * Type a 6-digit emailed code. Default: the code sent to a new address (the link in that mail still works).
 * With `send`, the button first emails a code (used to verify the current email).
 */
export function EmailCodeBox({ action, send, openLabel = "Have an email code? Enter it", label = "Code sent to your new email", submitLabel = "Confirm email" }: {
  action: (fd: FormData) => Promise<FormResult>;
  send?: () => Promise<FormResult>;
  openLabel?: string; label?: string; submitLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!open) {
    const openIt = () => send
      ? start(async () => { const r = await send(); if (r.ok) { toast(r.message ?? "Code sent"); setOpen(true); } else toast(r.error ?? "Could not send the code", "danger"); })
      : setOpen(true);
    return <button type="button" disabled={pending} onClick={openIt} className="mt-4 min-h-10 text-sm text-[var(--ds-on-surface-variant)] underline underline-offset-4 hover:text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">{pending ? "Sending…" : openLabel}</button>;
  }
  return (
    <form className="mt-4 flex flex-col gap-2 sm:max-w-xs" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const fd = new FormData();
        fd.set("code", code);
        const r = await action(fd);
        if (r.ok) { toast(r.message ?? "Email confirmed"); setOpen(false); setCode(""); setError(undefined); router.refresh(); } else setError(r.fieldErrors?.code ?? r.error);
      });
    }}>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
        {label}
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onPaste={(e) => { e.preventDefault(); setCode(e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)); }}
          inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required autoFocus placeholder="123456"
          aria-invalid={error ? true : undefined} className={`${INPUT} text-center font-mono text-lg tracking-[0.4em]`} />
      </label>
      {error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" isLoading={pending} className="h-10 rounded-full">{submitLabel}</Button>
        <Button type="button" variant="secondary" onClick={() => { setOpen(false); setError(undefined); }} className="h-10 rounded-full">Cancel</Button>
      </div>
    </form>
  );
}
