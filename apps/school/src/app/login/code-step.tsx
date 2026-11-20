"use client";

import { useEffect, useState, useTransition } from "react";
import { INPUT } from "@smw/ui/shell/FormModal";
import { resendResetCode, requestLoginCode, type CodeState } from "@/lib/auth-actions";

/** The 6-digit box: numeric keypad, one-time-code autofill, and a pasted "123 456" becomes 123456. */
export function CodeInput({ label = "6-digit code" }: { label?: string }) {
  const [v, setV] = useState("");
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
      {label}
      <input name="code" value={v} onChange={(e) => setV(e.target.value.replace(/\D/g, "").slice(0, 6))}
        onPaste={(e) => { e.preventDefault(); setV(e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6)); }}
        inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" required autoFocus placeholder="123456"
        className={`${INPUT} text-center font-mono text-lg tracking-[0.4em]`} />
    </label>
  );
}

/** "Resend code" with a 60 s countdown (the server also enforces it). */
export function ResendCode({ identifier, use }: { identifier: string; use: "reset" | "login" }) {
  const [left, setLeft] = useState(60);
  const [note, setNote] = useState<CodeState>();
  const [pending, start] = useTransition();
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  const send = () => start(async () => {
    const fd = new FormData();
    fd.set("identifier", identifier);
    setNote(await (use === "reset" ? resendResetCode : requestLoginCode)(undefined, fd));
    setLeft(60);
  });
  return (
    <div className="flex flex-col items-center gap-1">
      <button type="button" onClick={send} disabled={left > 0 || pending}
        className="min-h-10 rounded-full px-4 text-sm text-[var(--ds-on-surface-variant)] underline underline-offset-4 hover:text-[var(--ds-on-surface)] disabled:no-underline disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
        {left > 0 ? `Resend code in ${left}s` : pending ? "Sending…" : "Resend code"}
      </button>
      {note?.error ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{note.error}</p> : note?.sent ? <p role="status" className="text-xs text-[var(--ds-on-surface-muted)]">If an account matches, we&apos;ve emailed a new code.</p> : null}
    </div>
  );
}
