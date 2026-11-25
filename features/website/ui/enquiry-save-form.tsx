"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { keepValues, type FormResult } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";

/** A settings form: the inputs are drawn by the server page, this keeps what was typed when a rule says no, and says so next to the button. */
export function SaveForm({ action, children, label = "Save", message = "Saved" }: { action: (fd: FormData) => Promise<FormResult>; children: ReactNode; label?: string; message?: string }) {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const submit = (fd: FormData) => start(async () => {
    const r = await action(fd);
    if (r.ok) { setErrors({}); setError(null); toast(r.message ?? message); router.refresh(); }
    else { setErrors(r.fieldErrors ?? {}); setError(r.error); toast(r.error, "danger"); }
  });
  return (
    <form onSubmit={keepValues(submit)} className="flex flex-col gap-5" noValidate>
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="rounded-full" isLoading={pending}>{label}</Button>
        {error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error}{Object.values(errors).length ? `: ${Object.values(errors).join(", ")}` : ""}</p> : null}
      </div>
    </form>
  );
}
