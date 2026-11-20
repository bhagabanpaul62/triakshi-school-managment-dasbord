"use client";

import { useActionState, useState } from "react";
import { INPUT } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { setPassword, type SetPasswordState } from "./reset-password-actions";

/** The form. When the password is set it flips `onDone` before the page refresh swaps it for "link already used". */
export function ResetPasswordForm({ token, onDone }: { token: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<SetPasswordState, FormData>(async (prev, fd) => {
    const r = await setPassword(prev, fd);
    // Here, not in an effect: setting the password refreshes the page to "link already used" and would unmount this form first.
    if (r?.next) { onDone(); window.location.assign(r.next); }
    return r;
  }, undefined);
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [show, setShow] = useState(false);
  const kind = show ? "text" : "password";
  const short = pw.length > 0 && pw.length < 8;
  const mismatch = again.length > 0 && again !== pw;
  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
        New password
        <input name="password" type={kind} autoComplete="new-password" minLength={8} required autoFocus value={pw} onChange={(e) => setPw(e.target.value)}
          aria-invalid={short || undefined} aria-describedby="pw-hint" className={INPUT} />
        <span id="pw-hint" className={short ? "text-xs font-normal text-[var(--ds-color-danger-400)]" : "text-xs font-normal text-[var(--ds-on-surface-muted)]"}>
          {short ? `${8 - pw.length} more character${8 - pw.length === 1 ? "" : "s"} needed` : "At least 8 characters, not your login ID or date of birth"}
        </span>
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
        Type it again
        <input name="confirm" type={kind} autoComplete="new-password" minLength={8} required value={again} onChange={(e) => setAgain(e.target.value)}
          aria-invalid={mismatch || undefined} className={INPUT} />
        {mismatch ? <span className="text-xs font-normal text-[var(--ds-color-danger-400)]">The two passwords do not match yet</span> : null}
      </label>
      <label className="flex min-h-10 items-center gap-2 text-sm text-[var(--ds-on-surface-variant)]">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-4 w-4 accent-[var(--ds-primary)]" />
        Show password
      </label>
      {state?.error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{state.error}</p> : null}
      <Button type="submit" isLoading={pending || !!state?.next} disabled={pending || !!state?.next || short || mismatch || !pw || !again} className="mt-1 h-11 rounded-full">Set password and sign in</Button>
    </form>
  );
}
