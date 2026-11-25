"use client";

import { useId, useState, useTransition } from "react";
import { IconCheck, IconCopy, IconExternalLink, IconLifebuoy } from "@tabler/icons-react";
import { Modal, ModalFooter } from "@smw/ui/kit/Modal";
import { IconChip } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { FieldGrid, type Field, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";

type Result = { url: string; userName: string; expiresAt: string; emergency?: boolean };

/** Ask why, make the one-time link, show it once. The link works once, for five minutes. */
export function SupportLoginDialog({ schoolId, users, canWrite, action, access }: {
  schoolId: string;
  users: { id: string; name: string }[];
  canWrite: boolean;
  /** What the school allows: `allowed`, and the sentence to show when it does not. An owner may still enter in an emergency. */
  access: { allowed: boolean; message: string };
  action: (fd: FormData) => Promise<FormResult>;
}) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [link, setLink] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const formId = useId();

  const fields: Field[] = [
    { name: "reason", label: access.allowed ? "Why are you logging in?" : "Why is this an emergency?", type: "textarea", required: true, hint: access.allowed ? "Saved in the audit log, with your name." : "At least 20 characters. The school reads this, and is told you entered." },
    ...(users.length > 1 ? [{ name: "userId", label: "Sign in as", type: "select" as const, options: users.map((u) => ({ value: u.id, label: u.name })) }] : []),
    ...(canWrite ? [{ name: "allowWrites", label: "Changes", type: "checkbox" as const, placeholder: "Allow changes (otherwise read-only)" }] : []),
  ];

  const blocked = !access.allowed && !canWrite; // only an owner may enter against the school's setting; others are told who to ask
  const close = (v: boolean) => { setOpen(v); if (!v) { setLink(null); setErrors({}); setCopied(false); } };
  const submit = (fd: FormData) => start(async () => {
    fd.set("id", schoolId);
    if (!access.allowed) fd.set("emergency", "true");
    const r = await action(fd);
    if (r.ok) setLink(r.data as Result);
    else { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); }
  });
  const copy = async () => {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { toast("Could not copy. Select the link and copy it.", "danger"); }
  };

  return (
    <>
      <Button variant="secondary" className="rounded-full" onClick={() => setOpen(true)}><IconLifebuoy className="mr-1.5 h-4 w-4" aria-hidden />{access.allowed ? "Support login" : "Support login (not allowed)"}</Button>
      <Modal open={open} onOpenChange={close} size="md" title="Support login" dismissOnOutsideClick={false}
        description="Opens the school's panel as one of its administrators. 30 minutes, with a banner, and everything is logged."
        icon={<IconChip className="h-10 w-10"><IconLifebuoy className="h-4 w-4" /></IconChip>}
        footer={link || blocked
          ? <ModalFooter primary={{ label: "Done", onClick: () => close(false) }} />
          : <ModalFooter secondary={{ onClick: () => close(false) }} primary={{ label: "Create link", type: "submit", form: formId, loading: pending }} />}>
        {blocked ? (
          <p className="pt-2 text-sm text-[var(--ds-on-surface-variant)]" role="status">{access.message}</p>
        ) : link ? (
          <div className="flex flex-col gap-3 pt-2 text-sm">
            <p className="text-[var(--ds-on-surface-variant)]">Signing in as {link.userName}. This link works once and expires in 5 minutes.</p>
            <p className="select-all break-all rounded-xl bg-white/[0.05] p-3 font-mono text-xs">{link.url}</p>
            <div className="flex gap-2">
              <Button variant="secondary" className="rounded-full" onClick={copy}>{copied ? <IconCheck className="mr-1.5 h-4 w-4" /> : <IconCopy className="mr-1.5 h-4 w-4" />}{copied ? "Copied" : "Copy link"}</Button>
              <Button asChild className="rounded-full"><a href={link.url} target="_blank" rel="noreferrer"><IconExternalLink className="mr-1.5 h-4 w-4" aria-hidden />Open</a></Button>
            </div>
          </div>
        ) : (
          <form id={formId} action={submit} className="pt-2" noValidate>
            {!access.allowed ? <p className="mb-3 rounded-xl bg-[var(--ds-color-warning-500)]/10 p-3 text-sm text-[var(--ds-color-warning-300)]" role="status">{access.message} You are an owner, so you may enter in an emergency.</p> : null}
            <FieldGrid fields={fields} errors={errors} columns={1} />
          </form>
        )}
      </Modal>
    </>
  );
}
