"use client";

import { useState, useTransition } from "react";
import { IconHelp } from "@tabler/icons-react";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { Button } from "@smw/ui/ui/button";
import { askUs } from "./actions";

/** "Ask us" on every step: opens a support ticket of kind onboarding with the step filled in. The reply comes to the person asking. */
export function AskUs({ step, label }: { step: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () => start(async () => {
    const r = await askUs({ step, body });
    if (!r.ok) { setError(r.fieldErrors?.body ?? r.error); return; }
    toast(r.message ?? "Sent");
    setBody(""); setError(null); setOpen(false);
  });
  return (
    <div className="mt-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm text-[var(--ds-on-surface-variant)] hover:bg-white/[0.06]"><IconHelp className="h-4 w-4" aria-hidden />Ask us</button>
      {open ? (
        <div className="mt-2 rounded-2xl bg-white/[0.04] p-4">
          <label htmlFor="ask-us-body" className="text-sm text-[var(--ds-on-surface)]">What do you need help with on "{label}"?</label>
          <textarea id="ask-us-body" rows={3} value={body} onChange={(e) => { setBody(e.target.value); setError(null); }} aria-invalid={!!error} className={`${INPUT} mt-2`} />
          {error ? <p role="alert" className="mt-1 text-xs text-[var(--ds-color-danger-300)]">{error}</p> : null}
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--ds-on-surface-muted)]">The team replies in your notifications.</p>
            <Button type="button" onClick={send} disabled={pending || body.trim().length < 5} isLoading={pending} className="rounded-full">Send</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
