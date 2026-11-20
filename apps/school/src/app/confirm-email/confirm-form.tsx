"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@smw/ui/ui/button";
import { confirmEmail, type ConfirmState } from "./actions";

export function ConfirmForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<ConfirmState, FormData>(confirmEmail, undefined);
  if (state?.email) {
    return (
      <>
        <h1 className="mt-4 text-2xl font-medium tracking-tight">Email confirmed</h1>
        <p role="status" className="mt-2 text-sm text-[var(--ds-on-surface-variant)]">Your account email is now {state.email}. Reset links will go there.</p>
        <Link href="/app/profile" className="mt-6 inline-flex h-11 items-center rounded-full bg-white/[0.08] px-6 text-sm text-[var(--ds-on-surface)] hover:bg-white/[0.14] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Open my profile</Link>
      </>
    );
  }
  return (
    <form action={action}>
      <h1 className="mt-4 text-2xl font-medium tracking-tight">Confirm your new email</h1>
      <p className="mt-2 text-sm text-[var(--ds-on-surface-variant)]">Use {email} as the email for your account?</p>
      <input type="hidden" name="token" value={token} />
      {state?.error ? <p role="alert" className="mt-3 text-sm text-[var(--ds-color-danger-400)]">{state.error}</p> : null}
      <Button type="submit" isLoading={pending} className="mt-6 h-11 rounded-full">Confirm email</Button>
    </form>
  );
}
