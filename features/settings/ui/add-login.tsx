"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { Modal, ModalFooter } from "@smw/ui/kit/Modal";
import { FieldGrid, INPUT, keepValues, type Field, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { Button } from "@smw/ui/ui/button";

/**
 * "Add a login": name, email or mobile, role. After saving, an emailed invite goes to the person's page; when no mail went
 * (no email, or the mail failed, or "give me a link" was chosen) the 7-day access link is shown here once, to copy.
 */
export function AddLogin({ roles, action }: { roles: { value: string; label: string }[]; action: (fd: FormData) => Promise<FormResult> }) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ id: string; name: string; link: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const formId = useId();
  const fields: Field[] = [
    { name: "name", label: "Full name", required: true, wide: true },
    { name: "email", label: "Email", type: "email", hint: "They sign in with it. Needed to mail the invite." },
    { name: "phone", label: "Mobile", type: "tel", hint: "Use this when they have no email." },
    { name: "role", label: "Role", type: "select", required: true, options: roles, hint: "Teachers are added from Staff, so their classes stay linked." },
    { name: "send", label: "How do they get in?", type: "select", options: [{ value: "email", label: "Email them an invite" }, { value: "link", label: "I will give them a link" }] },
  ];
  const submit = (fd: FormData) => start(async () => {
    const r = await action(fd);
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); return; }
    const d = r.data as { id: string; name: string; emailed: boolean; accessLink: string | null };
    setErrors({});
    if (d.accessLink) { setDone({ id: d.id, name: d.name, link: d.accessLink }); return; }
    setOpen(false);
    toast(`Invite emailed to ${d.name}`);
    router.push(`/app/settings/users/${d.id}`);
  });
  const copy = async () => { try { await navigator.clipboard.writeText(done?.link ?? ""); toast("Copied"); } catch { toast("Could not copy. Select the text and copy it.", "danger"); } };
  const close = () => { setOpen(false); setDone(null); };
  return (
    <>
      <Button onClick={() => { setErrors({}); setDone(null); setOpen(true); }} className="rounded-full"><IconPlus className="mr-1.5 h-4 w-4" aria-hidden />Add a login</Button>
      <Modal open={open} onOpenChange={(o) => (o ? setOpen(true) : close())} size="md" title={done ? `Link for ${done.name}` : "Add a login"} dismissOnOutsideClick={false}
        description={done ? undefined : "For an admin, an accountant or a role you made. They set their own password."}
        footer={done
          ? <ModalFooter secondary={{ label: "Open their page", onClick: () => { router.push(`/app/settings/users/${done.id}`); close(); } }} primary={{ label: "Copy link", onClick: copy }} />
          : <ModalFooter secondary={{ onClick: close }} primary={{ label: "Add login", type: "submit", form: formId, loading: pending }} />}>
        {done ? (
          <div className="flex flex-col gap-3 pt-2">
            <input readOnly value={done.link} aria-label="Access link" onFocus={(e) => e.currentTarget.select()} className={`${INPUT} font-mono`} />
            <p className="text-sm text-[var(--ds-on-surface-muted)]">Valid for 7 days and works once. Anyone with the link can set the password, so share it only with {done.name}. If you lose it, make a new one from their page.</p>
          </div>
        ) : (
          <form id={formId} onSubmit={keepValues(submit)} className="pt-2" noValidate><FieldGrid fields={fields} values={{ send: "email" }} errors={errors} /></form>
        )}
      </Modal>
    </>
  );
}
