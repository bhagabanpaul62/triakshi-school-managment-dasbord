"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { Modal, ModalFooter } from "@smw/ui/kit/Modal";
import { IconChip } from "@smw/ui/kit/Panel";
import { FieldGrid, INPUT } from "@smw/ui/shell/FormModal";
import { MenuIconView } from "@smw/ui/shell/icons";
import { toast } from "@smw/ui/shell/toast";
import { Button } from "@smw/ui/ui/button";
import { createStaff } from "./actions";
import { createFields } from "./fields";

/** "Add staff": a short form whose footer says exactly what saving does (mails an invite to the address typed so far). */
export function AddStaffModal({ suggestedId, roleOptions }: { suggestedId: string; roleOptions: { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [email, setEmail] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const formId = useId();

  const submit = (fd: FormData) => start(async () => {
    const r = await createStaff(fd);
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); return; }
    const made = r.data as { id: string; emailed: boolean; email: string | null; accessLink: string | null };
    setOpen(false);
    // No email: stay on the list long enough to copy the link; the record opens when the dialog closes.
    if (made.accessLink) { toast("Added. Copy their access link and share it."); setLink({ id: made.id, url: made.accessLink }); return; }
    if (made.emailed) toast(`Added. An invite is on its way to ${made.email}.`);
    else toast("Added, but the invite email did not go out. Use Resend invite.", "danger");
    router.push(`/app/staff/${made.id}`);
  });

  const trimmed = email.trim();
  const summary = trimmed ? `Emails a set-password link to ${trimmed}` : "No email, so you get a link to share by hand";

  return (
    <>
      <Button onClick={() => { setErrors({}); setEmail(""); setOpen(true); }} className="rounded-full">
        <IconPlus className="mr-1.5 h-4 w-4" aria-hidden />Add staff
      </Button>
      <Modal open={open} onOpenChange={setOpen} size="lg" title="Add staff" description="They get an email to set their own password. You never see or share it."
        icon={<IconChip className="h-10 w-10"><MenuIconView name="teacher" /></IconChip>} dismissOnOutsideClick={false}
        footer={<ModalFooter summary={summary} secondary={{ onClick: () => setOpen(false) }} primary={{ label: trimmed ? "Add and invite" : "Add and get link", type: "submit", form: formId, loading: pending }} />}>
        <form id={formId} action={submit} className="pt-2" noValidate onInput={(e) => { const t = e.target as HTMLInputElement; if (t.name === "email") setEmail(t.value); }}>
          <FieldGrid fields={createFields(roleOptions)} values={{ role: "teacher", employeeId: suggestedId }} errors={errors} />
        </form>
      </Modal>
      <Modal open={!!link} onOpenChange={(o) => { if (!o && link) { router.push(`/app/staff/${link.id}`); setLink(null); } }} size="md" title="Access link" dismissOnOutsideClick={false}
        description="They have no email, so nothing was sent. Share this link (WhatsApp works) and they set their own password."
        footer={<ModalFooter secondary={{ label: "Done", onClick: () => { if (link) router.push(`/app/staff/${link.id}`); setLink(null); } }}
          primary={{ label: "Copy link", onClick: async () => { try { await navigator.clipboard.writeText(link?.url ?? ""); toast("Copied"); } catch { toast("Could not copy. Select the link and copy it.", "danger"); } } }} />}>
        <div className="flex flex-col gap-3 pt-2">
          <input readOnly value={link?.url ?? ""} aria-label="Access link" onFocus={(e) => e.currentTarget.select()} className={`${INPUT} font-mono`} />
          <p className="text-sm text-[var(--ds-on-surface-muted)]">The link works for 7 days and once only. You can make a new one later from Settings, Users.</p>
        </div>
      </Modal>
    </>
  );
}
