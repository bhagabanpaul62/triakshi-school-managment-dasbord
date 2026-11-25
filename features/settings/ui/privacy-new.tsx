"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { Modal, ModalField, ModalFooter } from "@smw/ui/kit/Modal";
import { Button } from "@smw/ui/ui/button";
import { RecordPicker } from "@smw/ui/finance/RecordPicker";
import { INPUT, keepValues } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { PRIVACY_KIND_WORDS, PRIVACY_KINDS } from "../privacy-kinds";
import { searchPeople, writeDownRequest } from "./data-actions";

/** The office writes a request down (a parent came to the desk or wrote). Who it is about is found by typing a name. */
export function PrivacyNew({ owners }: { owners: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const formId = useId();
  const submit = (fd: FormData) => start(async () => {
    const r = await writeDownRequest(fd);
    if (r.ok) { setOpen(false); setErrors({}); toast(r.message ?? "Saved"); router.refresh(); } else { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); }
  });
  const field = (key: string, label: string, el: React.ReactNode, wide = false) => <ModalField label={label} htmlFor={`${formId}-${key}`} error={errors[key]} className={wide ? "sm:col-span-2" : undefined}>{el}</ModalField>;
  return (
    <>
      <Button className="rounded-full" onClick={() => { setErrors({}); setName(""); setOpen(true); }}><IconPlus className="mr-1.5 h-4 w-4" aria-hidden />Write down a request</Button>
      <Modal open={open} onOpenChange={setOpen} size="lg" title="Write down a privacy request" description="Someone asked the school about their data, at the desk or in writing. It gets a number and a due date." dismissOnOutsideClick={false}
        footer={<ModalFooter secondary={{ onClick: () => setOpen(false) }} primary={{ label: "Save the request", type: "submit", form: formId, loading: pending }} />}>
        <form id={formId} onSubmit={keepValues(submit)} noValidate className="grid gap-4 pt-2 sm:grid-cols-2">
          {field("kind", "What are they asking for?", <select id={`${formId}-kind`} name="kind" defaultValue="access" className={INPUT}>{PRIVACY_KINDS.map((k) => <option key={k} value={k}>{PRIVACY_KIND_WORDS[k]}</option>)}</select>, true)}
          <div className="sm:col-span-2"><RecordPicker action={searchPeople} name="subject" label="Whose data is it?" placeholder="Type a student or staff name" hotkey={false} onChange={(p) => { if (p[0]) setName(p[0].label); }} /></div>
          {field("subjectName", "Name", <input id={`${formId}-subjectName`} name="subjectName" value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />)}
          {field("raisedByName", "Who is asking?", <input id={`${formId}-raisedByName`} name="raisedByName" className={INPUT} placeholder="Parent or guardian name" />)}
          {field("contact", "How to reach them", <input id={`${formId}-contact`} name="contact" className={INPUT} placeholder="Phone or email" />)}
          {field("ownerId", "Who answers it?", <select id={`${formId}-ownerId`} name="ownerId" defaultValue="" className={INPUT}><option value="">Me</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>)}
          {field("details", "What did they ask?", <textarea id={`${formId}-details`} name="details" rows={4} className={`${INPUT} h-auto py-2`} />, true)}
        </form>
      </Modal>
    </>
  );
}
