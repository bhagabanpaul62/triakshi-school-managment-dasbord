"use client";

import { useState, useTransition } from "react";
import { INPUT } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { changeMyPassword } from "./profile-actions";

export function ChangePasswordForm() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [fields, setFields] = useState<Record<string, string>>({});
  const [show, setShow] = useState(false);
  const kind = show ? "text" : "password";
  const submit = (fd: FormData) => start(async () => {
    const r = await changeMyPassword(fd);
    if (r.ok) { window.location.assign("/app"); return; } // full load: the panel then renders fresh for the cleared flag
    setFields(r.fieldErrors ?? {});
    setError(r.error);
  });
  return (
    <form action={submit} className="mt-6 flex flex-col gap-4">
      {([
        ["current", "Current password", "current-password"],
        ["next", "New password", "new-password"],
        ["confirm", "New password again", "new-password"],
      ] as const).map(([name, label, auto], i) => (
        <label key={name} className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">
          {label}
          <input name={name} type={kind} autoComplete={auto} required autoFocus={i === 0} aria-invalid={fields[name] ? true : undefined} className={INPUT} />
          {fields[name] ? <span className="text-xs font-normal text-[var(--ds-color-danger-400)]">{fields[name]}</span> : name === "next" ? <span className="text-xs font-normal text-[var(--ds-on-surface-muted)]">At least 8 characters, not your login ID or date of birth.</span> : null}
        </label>
      ))}
      <label className="flex min-h-10 items-center gap-2 text-sm text-[var(--ds-on-surface-variant)]">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-4 w-4 accent-[var(--ds-primary)]" />
        Show passwords
      </label>
      {error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
      <Button type="submit" isLoading={pending} className="mt-1 h-11 rounded-full">Save and continue</Button>
    </form>
  );
}
