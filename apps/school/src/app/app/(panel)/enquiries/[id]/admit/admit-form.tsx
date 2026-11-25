"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FieldGrid, keepValues, type Field, type FormResult } from "@smw/ui/shell/FormModal";
import { RecordPicker } from "@smw/ui/finance/RecordPicker";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";

type Done = { studentId: string; marked: boolean; message?: string; capacityMessage?: string | null };
type Action = (fd: FormData) => Promise<FormResult & { data?: unknown }>;

/** Admit as a new student. When the student was made but the enquiry could not be marked, say so and offer to try again. */
export function AdmitForm({ enquiryId, fields, values, action }: { enquiryId: string; fields: Field[]; values: Record<string, unknown>; action: Action }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lost, setLost] = useState<Done | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const formId = useId();
  const finish = (d: Done) => { toast(d.capacityMessage ? `Student admitted. ${d.capacityMessage}` : "Student admitted"); router.push(`/app/enquiries/${enquiryId}`); router.refresh(); };
  const run = (fd: FormData) => start(async () => {
    fd.set("enquiryId", enquiryId);
    if (lost) fd.set("studentId", lost.studentId);
    const r = await action(fd);
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); return; }
    const d = r.data as Done;
    if (d.marked) finish(d); else { setLost(d); toast("The student was admitted, but the enquiry was not marked", "danger"); }
  });
  return (
    <form id={formId} onSubmit={keepValues(run)} className="flex flex-col gap-5" noValidate>
      {lost ? (
        <div role="alert" className="flex flex-col gap-2 rounded-2xl bg-[var(--ds-color-danger-500)]/10 p-4 text-sm">
          <p className="text-[var(--ds-color-danger-300)]">The student was admitted, but the enquiry could not be marked as admitted: {lost.message} Do not admit them again. Try marking it again.</p>
          <div className="flex flex-wrap gap-2"><Button type="submit" className="rounded-full" isLoading={pending}>Try marking again</Button><Button asChild variant="secondary" className="rounded-full"><a href={`/app/students/${lost.studentId}`}>Open the student</a></Button></div>
        </div>
      ) : null}
      <fieldset disabled={!!lost} className="contents"><FieldGrid fields={fields} values={values} errors={errors} /></fieldset>
      {lost ? null : <div><Button type="submit" className="rounded-full" isLoading={pending}>Admit student</Button></div>}
    </form>
  );
}

/** Link the enquiry to a student who is already in the school. */
export function LinkStudent({ enquiryId, find, action }: { enquiryId: string; find: (q: string) => Promise<{ id: string; label: string; meta?: string }[]>; action: Action }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | undefined>();
  const router = useRouter();
  const submit = (fd: FormData) => start(async () => {
    fd.set("enquiryId", enquiryId);
    const r = await action(fd);
    if (r.ok) { toast("Linked"); router.push(`/app/enquiries/${enquiryId}`); router.refresh(); } else { setErr(r.error); toast(r.error, "danger"); }
  });
  return (
    <form onSubmit={keepValues(submit)} className="flex flex-col gap-3" noValidate>
      <RecordPicker name="studentId" label="Student" placeholder="Search by name or admission number" action={find} error={err} required />
      <div><Button type="submit" variant="secondary" className="rounded-full" isLoading={pending}>Link to this student</Button></div>
    </form>
  );
}
