"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalFooter } from "@smw/ui/kit/Modal";
import { Button } from "@smw/ui/ui/button";
import { RecordPicker } from "@smw/ui/finance/RecordPicker";
import { keepValues } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { askStudentExport, searchStudents } from "./data-actions";

/** One student's file: the person is found by typing (server search, 15 at a time), never from a 1,000-row dropdown. */
export function ExportStudent({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();
  const formId = useId();
  const submit = (fd: FormData) => start(async () => {
    const r = await askStudentExport(fd);
    if (r.ok) { setOpen(false); setError(undefined); toast(r.message ?? "Queued"); router.refresh(); } else { setError(r.fieldErrors?.studentId ?? r.error); toast(r.error, "danger"); }
  });
  return (
    <>
      <Button variant="secondary" className="rounded-full" onClick={() => { setError(undefined); setOpen(true); }} disabled={disabled}>Export one student</Button>
      <Modal open={open} onOpenChange={setOpen} size="md" title="Export one student" description="Their profile, attendance, fees, marks, and the conversations and requests about them. The export is logged." dismissOnOutsideClick={false}
        footer={<ModalFooter secondary={{ onClick: () => setOpen(false) }} primary={{ label: "Make the export", type: "submit", form: formId, loading: pending }} />}>
        <form id={formId} onSubmit={keepValues(submit)} className="pt-2" noValidate>
          <RecordPicker action={searchStudents} name="studentId" label="Student" placeholder="Type a name or admission number" required error={error} hotkey={false} />
        </form>
      </Modal>
    </>
  );
}
