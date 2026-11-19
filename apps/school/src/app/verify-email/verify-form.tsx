"use client";

import { useActionState } from "react";
import { INPUT } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { completeVerification, type VerifyState } from "./actions";

export function VerifyForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<VerifyState, FormData>(completeVerification, undefined);
  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
        Choose a password
        <input name="password" type="password" autoComplete="new-password" minLength={8} required autoFocus className={INPUT} />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
        Type it again
        <input name="confirm" type="password" autoComplete="new-password" minLength={8} required className={INPUT} />
      </label>
      {state?.error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{state.error}</p> : null}
      <Button type="submit" isLoading={pending} className="mt-2 h-11 rounded-full">Confirm email and continue</Button>
    </form>
  );
}
