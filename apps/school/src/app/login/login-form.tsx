"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { INPUT } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { login, loginWithCode, requestLoginCode, type CodeState, type LoginState, type ResetCodeState } from "@/lib/auth-actions";
import { CodeInput, ResendCode } from "./code-step";

const LINK = "self-center py-1 text-sm text-[var(--ds-on-surface-variant)] underline underline-offset-4 hover:text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";

export function LoginForm({ next, initialId = "" }: { next?: string; initialId?: string }) {
  const [mode, setMode] = useState<"password" | "code">("password");
  const [id, setId] = useState(initialId);
  const [state, action, pending] = useActionState<LoginState, FormData>(login, undefined);
  const [sendState, sendAction, sending] = useActionState<CodeState, FormData>(requestLoginCode, undefined);
  const [codeState, codeAction, verifying] = useActionState<ResetCodeState, FormData>(loginWithCode, undefined);
  const [show, setShow] = useState(false);

  if (mode === "code" && sendState?.sent) {
    return (
      <form action={codeAction} className="mt-6 flex flex-col gap-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <input type="hidden" name="identifier" value={sendState.identifier} />
        <p role="status" className="rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-[var(--ds-on-surface)]">If an account matches, we&apos;ve emailed a 6-digit code. It works for 10 minutes.</p>
        <CodeInput />
        {codeState?.error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{codeState.error}</p> : null}
        <Button type="submit" isLoading={verifying} className="h-11 rounded-full">Sign in</Button>
        <ResendCode identifier={sendState.identifier!} use="login" />
        <button type="button" onClick={() => setMode("password")} className={LINK}>Use my password instead</button>
      </form>
    );
  }
  if (mode === "code") {
    return (
      <form action={sendAction} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
          Email, phone or admission number
          <input name="identifier" autoComplete="username" required autoFocus value={id} onChange={(e) => setId(e.target.value)} className={INPUT} />
        </label>
        <p className="text-xs text-[var(--ds-on-surface-muted)]">We email a 6-digit code to the address on your account. No email on file? Ask your school office.</p>
        {sendState?.error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{sendState.error}</p> : null}
        <Button type="submit" isLoading={sending} className="h-11 rounded-full">Email me a code</Button>
        <button type="button" onClick={() => setMode("password")} className={LINK}>Use my password instead</button>
      </form>
    );
  }
  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
        Email, phone or admission number
        <input name="identifier" autoComplete="username" required autoFocus={!initialId} value={id} onChange={(e) => setId(e.target.value)} className={INPUT} />
      </label>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="login-password" className="text-[13px] font-medium text-[var(--ds-on-surface-variant)]">Password</label>
        <div className="relative">
          <input id="login-password" name="password" type={show ? "text" : "password"} autoComplete="current-password" required autoFocus={!!initialId} className={`${INPUT} pr-16`} />
          <button type="button" onClick={() => setShow((v) => !v)} aria-pressed={show}
            className="absolute inset-y-0 right-1 my-auto h-8 rounded-full px-3 text-xs text-[var(--ds-on-surface-variant)] hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
            {show ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      {state?.error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{state.error}</p> : null}
      <Button type="submit" isLoading={pending} className="mt-2 h-11 rounded-full">Sign in</Button>
      <button type="button" onClick={() => setMode("code")} className={LINK}>Email me a code instead</button>
      <Link href="/forgot-password" className={LINK}>Forgot password?</Link>
    </form>
  );
}
