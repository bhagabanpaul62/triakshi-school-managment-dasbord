"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { IconTrash } from "@tabler/icons-react";
import { Modal, ModalFooter } from "../components/dashboard/kit/Modal";
import { IconChip } from "../components/dashboard/kit/Panel";
import { Button } from "../components/ui/button";
import { toast } from "./toast";
import type { FormResult } from "./FormModal";

export interface ActionButtonProps {
  /** Server action, called with the hidden values as FormData. */
  action: (fd: FormData) => Promise<FormResult>;
  values?: Record<string, string>;
  label: string;
  /** Ask first: title and the exact consequence ("Deletes Riya Sharma and her attendance. Cannot be undone."). */
  confirm?: { title: string; body: string; confirmLabel?: string; danger?: boolean };
  variant?: "default" | "secondary" | "ghost" | "icon-delete";
  successMessage?: string;
  redirectTo?: string;
  children?: ReactNode;
}

/** A button that runs one server action, optionally behind a confirmation dialog. */
export function ActionButton({ action, values = {}, label, confirm, variant = "secondary", successMessage = "Done", redirectTo, children }: ActionButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  const run = () => start(async () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    const r = await action(fd);
    setOpen(false);
    if (r.ok) { toast(r.message ?? successMessage); if (redirectTo) router.push(redirectTo); else router.refresh(); }
    else toast(r.error, "danger");
  });

  const trigger = variant === "icon-delete" ? (
    <button type="button" onClick={() => (confirm ? setOpen(true) : run())} aria-label={label} title={label} disabled={pending}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--ds-on-surface-muted)] opacity-70 transition hover:bg-[var(--ds-color-danger-500)]/15 hover:text-[var(--ds-color-danger-400)] hover:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
      <IconTrash className="h-4 w-4" aria-hidden />
    </button>
  ) : (
    <Button type="button" variant={variant} className="rounded-full" isLoading={pending} onClick={() => (confirm ? setOpen(true) : run())}>{children ?? label}</Button>
  );

  return (
    <>
      {trigger}
      {confirm ? (
        <Modal open={open} onOpenChange={setOpen} size="sm" title={confirm.title} tone={confirm.danger ? "danger" : undefined}
          icon={confirm.danger ? <IconChip className="h-10 w-10 text-[var(--ds-color-danger-400)]"><IconTrash className="h-4 w-4" /></IconChip> : undefined}
          footer={<ModalFooter danger={confirm.danger} secondary={{ onClick: () => setOpen(false) }} primary={{ label: confirm.confirmLabel ?? label, onClick: run, loading: pending }} />}>
          <p className="pt-2 text-sm text-[var(--ds-on-surface-variant)]">{confirm.body}</p>
        </Modal>
      ) : null}
    </>
  );
}
