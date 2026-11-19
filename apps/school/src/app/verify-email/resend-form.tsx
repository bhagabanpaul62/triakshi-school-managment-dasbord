"use client";

import { useActionState } from "react";
import { INPUT } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { resendVerification, type ResendState } from "@smw/feature-setup/resend";

/** The dead end of an expired link: ask for a new one by email, no support ticket needed. */
export function ResendForm() {
  const [state, action, pending] = useActionState<ResendState, FormData>(resendVerification, undefined);
  if (state?.message) return <p role="status" className="mt-5 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-[var(--ds-on-surface)]">{state.message}</p>;
  return (
    <form action={action} className="mt-5 flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
        Email you registered with
        <input name="email" type="email" autoComplete="email" required className={INPUT} placeholder="you@school.in" />
      </label>
      {state?.error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{state.error}</p> : null}
      <Button type="submit" isLoading={pending} className="h-11 rounded-full">Send me a new link</Button>
    </form>
  );
}
