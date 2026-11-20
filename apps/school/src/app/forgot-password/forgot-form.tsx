"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { INPUT } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { forgotPassword, resetWithCode, type ForgotState, type ResetCodeState } from "@/lib/auth-actions";
import { CodeInput, ResendCode } from "../login/code-step";

const OFFICE = "No email on file? Ask your school office for a reset link.";
const LINK = "self-center py-1 text-sm text-[var(--ds-on-surface-variant)] underline underline-offset-4 hover:text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";

export function ForgotForm() {
  const [state, action, pending] = useActionState<ForgotState, FormData>(forgotPassword, undefined);
  const [codeState, codeAction, verifying] = useActionState<ResetCodeState, FormData>(resetWithCode, undefined);
  const [pw, setPw] = useState("");
  const [again, setAgain] = useState("");
  const [show, setShow] = useState(false);
  const [linkOnly, setLinkOnly] = useState(false);

  if (state?.done && linkOnly) {
    return (
      <div className="mt-6 flex flex-col gap-3">
        <p role="status" className="rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-[var(--ds-on-surface)]">If an account matches, we&apos;ve emailed a reset link. Open it on this device.</p>
        <p className="text-sm text-[var(--ds-on-surface-muted)]">{OFFICE}</p>
        <button type="button" onClick={() => setLinkOnly(false)} className={LINK}>Enter the code instead</button>
        <Link href="/login" className="inline-flex h-11 items-center justify-center rounded-full bg-white/[0.08] px-6 text-sm text-[var(--ds-on-surface)] hover:bg-white/[0.14] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Back to sign in</Link>
      </div>
    );
  }
  if (state?.done) {
    const kind = show ? "text" : "password";
    const mismatch = again.length > 0 && again !== pw;
    return (
      <form action={codeAction} className="mt-6 flex flex-col gap-4">
        <input type="hidden" name="identifier" value={state.identifier} />
        <p role="status" className="rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-[var(--ds-on-surface)]">If an account matches, we&apos;ve emailed a 6-digit code and a reset link. The code works for 10 minutes.</p>
        <CodeInput />
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
          New password
          <input name="password" type={kind} autoComplete="new-password" minLength={8} required value={pw} onChange={(e) => setPw(e.target.value)} className={INPUT} />
          <span className="text-xs font-normal text-[var(--ds-on-surface-muted)]">At least 8 characters, not your login ID or date of birth</span>
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
          Type it again
          <input name="confirm" type={kind} autoComplete="new-password" minLength={8} required value={again} onChange={(e) => setAgain(e.target.value)} aria-invalid={mismatch || undefined} className={INPUT} />
          {mismatch ? <span className="text-xs font-normal text-[var(--ds-color-danger-400)]">The two passwords do not match yet</span> : null}
        </label>
        <label className="flex min-h-10 items-center gap-2 text-sm text-[var(--ds-on-surface-variant)]">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-4 w-4 accent-[var(--ds-primary)]" />
          Show password
        </label>
        {codeState?.error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{codeState.error}</p> : null}
        <Button type="submit" isLoading={verifying} disabled={verifying || mismatch} className="h-11 rounded-full">Set password and sign in</Button>
        <ResendCode identifier={state.identifier!} use="reset" />
        <button type="button" onClick={() => setLinkOnly(true)} className={LINK}>Use the link in the mail instead</button>
      </form>
    );
  }
  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
        Email, phone or admission number
        <input name="identifier" autoComplete="username" required autoFocus className={INPUT} />
      </label>
      {state?.error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{state.error}</p> : null}
      <Button type="submit" isLoading={pending} className="mt-2 h-11 rounded-full">Email me a code</Button>
      <p className="text-center text-xs text-[var(--ds-on-surface-muted)]">{OFFICE}</p>
      <Link href="/login" className={LINK}>Back to sign in</Link>
    </form>
  );
}
