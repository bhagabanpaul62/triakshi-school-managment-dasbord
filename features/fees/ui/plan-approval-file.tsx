"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";
import { removePlanFile, uploadPlanFile } from "./actions";
import { CARD, H3, MUTED } from "./styles";

/** The committee's decision on the plan (PDF, JPG or PNG, 10 MB), kept privately and shown to whoever approves. Only a draft can change it. */
export function PlanApprovalFile({ planId, file, required, editable }: { planId: string; file: { name: string; href: string } | null; required: boolean; editable: boolean }) {
  const router = useRouter(), input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState(""), [pending, start] = useTransition();
  const upload = () => start(async () => {
    const f = input.current?.files?.[0];
    if (!f) return void setError("Choose the file first.");
    const fd = new FormData(); fd.set("id", planId); fd.set("file", f);
    const r = await uploadPlanFile(fd);
    if (!r.ok) return void setError(r.fieldErrors?.file ?? r.error);
    setError(""); toast(r.message ?? "File attached"); if (input.current) input.current.value = ""; router.refresh();
  });
  const remove = () => start(async () => {
    const fd = new FormData(); fd.set("id", planId);
    const r = await removePlanFile(fd);
    if (!r.ok) return void setError(r.error);
    toast(r.message ?? "File removed"); router.refresh();
  });
  return (
    <section className={`${CARD} flex flex-col gap-3`} aria-label="Committee approval file">
      <h2 className={H3}>Committee approval file</h2>
      {file ? <p className="text-sm"><a href={file.href} target="_blank" rel="noopener" className="underline underline-offset-4">{file.name}</a></p>
        : <p className={`text-sm ${required && editable ? "text-[var(--ds-color-warning-400)]" : MUTED}`}>{required ? "None attached. The school asks for it before a plan is sent for approval." : "None attached."}</p>}
      {editable ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1.5 text-sm">{file ? "Replace with" : "Attach"}<input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-white/[0.1] file:px-4 file:py-2 file:text-sm" /></label>
          {error ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{error}</p> : null}
          <div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" className="rounded-full" isLoading={pending} onClick={upload}>{file ? "Replace file" : "Attach file"}</Button>{file ? <Button type="button" variant="ghost" className="rounded-full" disabled={pending} onClick={remove}>Remove</Button> : null}</div>
          <p className={MUTED}>PDF, JPG or PNG, up to 10 MB. Kept privately; the approver can open it.</p>
        </div>
      ) : null}
    </section>
  );
}
