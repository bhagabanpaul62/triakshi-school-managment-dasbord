"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { FieldGrid, keepValues, type Field, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";

/** A form on the page that sends the person to the thing it made: `hrefPrefix` + the id the action returned. */
export function RedirectForm({ fields, action, hrefPrefix, submitLabel = "Save", values, hidden, summary }: { fields: Field[]; action: (fd: FormData) => Promise<FormResult>; hrefPrefix: string; submitLabel?: string; values?: Record<string, unknown>; hidden?: Record<string, string>; summary?: string }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const submit = (fd: FormData) => start(async () => {
    for (const f of fields) if (f.type === "money" && fd.get(f.name)) fd.set(f.name, String(Math.round(Number(fd.get(f.name)) * 100)));
    for (const [k, v] of Object.entries(hidden ?? {})) fd.set(k, v);
    const r = await action(fd);
    if (r.ok) { toast(r.message ?? "Saved"); router.push(`${hrefPrefix}${(r.data as { id?: string } | undefined)?.id ?? ""}`); }
    else { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); }
  });
  return (
    <form onSubmit={keepValues(submit)} noValidate className="flex max-w-2xl flex-col gap-6">
      <FieldGrid fields={fields} values={values} errors={errors} />
      {summary ? <p className="text-sm text-[var(--ds-on-surface-muted)]">{summary}</p> : null}
      <div><Button type="submit" className="rounded-full" isLoading={pending}>{submitLabel}</Button></div>
    </form>
  );
}
