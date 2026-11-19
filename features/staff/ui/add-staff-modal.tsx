"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { Modal, ModalFooter } from "@smw/ui/kit/Modal";
import { IconChip } from "@smw/ui/kit/Panel";
import { FieldGrid } from "@smw/ui/shell/FormModal";
import { MenuIconView } from "@smw/ui/shell/icons";
import { toast } from "@smw/ui/shell/toast";
import { Button } from "@smw/ui/ui/button";
import { createStaff } from "./actions";
import { createFields } from "./fields";

/** "Add staff": a short form whose footer says exactly what saving does (mails an invite to the address typed so far). */
export function AddStaffModal({ suggestedId }: { suggestedId: string }) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [email, setEmail] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const formId = useId();

  const submit = (fd: FormData) => start(async () => {
    const r = await createStaff(fd);
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); return; }
    const made = r.data as { id: string; emailed: boolean; email: string | null };
    setOpen(false);
    if (made.emailed) toast(`Added. An invite is on its way to ${made.email}.`);
    else toast(made.email ? "Added, but the invite email did not go out. Use Resend invite." : "Added. Add an email to send them an invite.", made.email ? "danger" : "default");
    router.push(`/app/staff/${made.id}`);
  });

  const trimmed = email.trim();
  const summary = trimmed ? `Emails a set-password link to ${trimmed}` : "No email yet, so no invite is sent";

  return (
    <>
      <Button onClick={() => { setErrors({}); setEmail(""); setOpen(true); }} className="rounded-full">
        <IconPlus className="mr-1.5 h-4 w-4" aria-hidden />Add staff
      </Button>
      <Modal open={open} onOpenChange={setOpen} size="lg" title="Add staff" description="They get an email to set their own password. You never see or share it."
        icon={<IconChip className="h-10 w-10"><MenuIconView name="teacher" /></IconChip>} dismissOnOutsideClick={false}
        footer={<ModalFooter summary={summary} secondary={{ onClick: () => setOpen(false) }} primary={{ label: trimmed ? "Add and invite" : "Add", type: "submit", form: formId, loading: pending }} />}>
        <form id={formId} action={submit} className="pt-2" noValidate onInput={(e) => { const t = e.target as HTMLInputElement; if (t.name === "email") setEmail(t.value); }}>
          <FieldGrid fields={createFields} values={{ role: "teacher", employeeId: suggestedId }} errors={errors} />
        </form>
      </Modal>
    </>
  );
}
