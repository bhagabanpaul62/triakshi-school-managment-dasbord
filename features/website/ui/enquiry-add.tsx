"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { Modal, ModalFooter } from "@smw/ui/kit/Modal";
import { FieldGrid, keepValues, type Field, type FormResult } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";

/** Add an enquiry, then land on it (its page shows the next step and any other enquiry from the same phone). */
export function AddEnquiry({ fields, values, action }: { fields: Field[]; values?: Record<string, unknown>; action: (fd: FormData) => Promise<FormResult> }) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const formId = useId();
  const submit = (fd: FormData) => start(async () => {
    const r = await action(fd);
    if (r.ok) {
      const d = r.data as { id: string; duplicates: number };
      toast(d.duplicates ? "Added. Another enquiry has this phone number: check if they are the same family." : "Enquiry added");
      setOpen(false);
      router.push(`/app/enquiries/${d.id}`);
    } else { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); }
  });
  return (
    <>
      <Button className="rounded-full" onClick={() => { setErrors({}); setOpen(true); }}><IconPlus className="mr-1.5 h-4 w-4" aria-hidden />Add enquiry</Button>
      <Modal open={open} onOpenChange={setOpen} size="lg" title="Add enquiry" description="For a call or a visit to the office. Families who use the website form appear on their own." dismissOnOutsideClick={false}
        footer={<ModalFooter secondary={{ onClick: () => setOpen(false) }} primary={{ label: "Add", type: "submit", form: formId, loading: pending }} />}>
        <form id={formId} onSubmit={keepValues(submit)} className="pt-2" noValidate><FieldGrid fields={fields} values={values} errors={errors} /></form>
      </Modal>
    </>
  );
}
