"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { FieldGrid, keepValues, type Field, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";

/** A form on the page itself (settings), with the same fields, money handling and toasts as FormModal. */
export function InlineForm({ fields, values, action, submitLabel = "Save", hidden }: { fields: Field[]; values?: Record<string, unknown>; action: (fd: FormData) => Promise<FormResult>; submitLabel?: string; hidden?: Record<string, string> }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const submit = (fd: FormData) => start(async () => {
    for (const f of fields) if (f.type === "money" && fd.get(f.name)) fd.set(f.name, String(Math.round(Number(fd.get(f.name)) * 100)));
    for (const [k, v] of Object.entries(hidden ?? {})) fd.set(k, v);
    const r = await action(fd);
    if (r.ok) { setErrors({}); toast(r.message ?? "Saved"); router.refresh(); }
    else { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); }
  });
  return (
    <form onSubmit={keepValues(submit)} noValidate className="flex flex-col gap-6">
      <FieldGrid fields={fields} values={values} errors={errors} />
      <div><Button type="submit" className="rounded-full" isLoading={pending}>{submitLabel}</Button></div>
    </form>
  );
}
