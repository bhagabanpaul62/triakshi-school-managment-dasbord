"use client";

import { useActionState } from "react";
import { INPUT } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { login, type AuthState } from "@/lib/auth-actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(login, undefined);
  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
        Email
        <input name="email" type="email" autoComplete="username" required autoFocus className={INPUT} />
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
        Password
        <input name="password" type="password" autoComplete="current-password" required className={INPUT} />
      </label>
      {state?.error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{state.error}</p> : null}
      <Button type="submit" isLoading={pending} className="mt-2 h-11 rounded-full">Continue</Button>
    </form>
  );
}
