"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ResetPasswordForm } from "./reset-password-form";

export type CardState =
  | { kind: "form"; token: string; heading: string; intro: string }
  | { kind: "problem"; title: string; body: string };

/** Heading plus form or problem message. Lives on the client so "Signing you in" survives the refresh that follows setting the password. */
export function ResetPasswordCard({ state }: { state: CardState }) {
  const [done, setDone] = useState(false);
  const onDone = useCallback(() => setDone(true), []);
  if (done) {
    return (
      <>
        <h1 className="mt-6 text-2xl font-medium tracking-tight">Password set</h1>
        <p role="status" className="mt-2 text-sm text-[var(--ds-on-surface-variant)]">Signing you in…</p>
      </>
    );
  }
  if (state.kind === "form") {
    return (
      <>
        <h1 className="mt-6 text-2xl font-medium tracking-tight">{state.heading}</h1>
        <p className="mt-1 text-sm text-[var(--ds-on-surface-muted)]">{state.intro}</p>
        <ResetPasswordForm token={state.token} onDone={onDone} />
      </>
    );
  }
  return (
    <>
      <h1 className="mt-6 text-2xl font-medium tracking-tight">{state.title}</h1>
      <p role="alert" className="mt-2 text-sm text-[var(--ds-on-surface-variant)]">{state.body}</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/forgot-password" className="inline-flex h-11 items-center rounded-full bg-[var(--ds-color-primary-500)] px-6 text-sm text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Forgot password</Link>
        <Link href="/login" className="inline-flex h-11 items-center rounded-full bg-white/[0.08] px-6 text-sm text-[var(--ds-on-surface)] transition-colors hover:bg-white/[0.14] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Go to sign in</Link>
      </div>
    </>
  );
}
