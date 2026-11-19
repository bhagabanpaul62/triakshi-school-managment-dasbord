"use client";

import { useActionState } from "react";
import { INPUT } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { verifyTwoFactor, type AuthState } from "@/lib/auth-actions";

/** Code box. `enrol` carries the new secret on a first login; the secret and URI are shown so the authenticator can be set up without a QR code. */
export function TwoFactorForm({ enrol, uri }: { enrol?: string; uri?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(verifyTwoFactor, undefined);
  return (
    <form action={action} className="mt-6 flex flex-col gap-4">
      {enrol ? (
        <div className="flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-4 text-sm">
          <p className="text-[var(--ds-on-surface-variant)]">Add this account in an authenticator app (Google Authenticator, Authy, 1Password) with the setup key, then enter the code it shows.</p>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">Setup key</p>
            <p className="mt-1 select-all break-all font-mono text-[15px] tracking-wider">{enrol.replace(/(.{4})/g, "$1 ").trim()}</p>
          </div>
          <details>
            <summary className="cursor-pointer text-[13px] text-[var(--ds-on-surface-muted)]">Setup link (otpauth)</summary>
            <p className="mt-2 select-all break-all font-mono text-xs text-[var(--ds-on-surface-variant)]">{uri}</p>
          </details>
          <input type="hidden" name="enrol" value={enrol} />
        </div>
      ) : null}
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
        6-digit code
        <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} required autoFocus className={`${INPUT} tracking-[0.3em]`} />
      </label>
      {state?.error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{state.error}</p> : null}
      <Button type="submit" isLoading={pending} className="mt-2 h-11 rounded-full">{enrol ? "Turn on and sign in" : "Verify"}</Button>
    </form>
  );
}
