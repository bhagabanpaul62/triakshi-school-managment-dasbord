"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalField, ModalFooter } from "../dashboard/kit/Modal";
import { Button } from "../ui/button";
import { INPUT, type FormResult } from "../../shell/FormModal";
import { toast } from "../../shell/toast";
import { Money } from "./Money";

export interface ConfirmMoneyProps {
  /** Server action. Receives `values`, plus `reason` and `amountPaise`. */
  action: (fd: FormData) => Promise<FormResult>;
  values?: Record<string, string>;
  /** Text on the button that opens the dialog: "Reverse receipt". */
  label: string;
  /** Dialog title. Default: the label. */
  title?: string;
  /** The amount that moves, in paise. Shown large and sent as `amountPaise`. */
  amountPaise: number;
  /** One line on what will happen to it: "Moves it back to Riya's dues." */
  consequence?: ReactNode;
  /** Asks for a reason (sent as `reason`). Default true. */
  reason?: false | { label?: string; required?: boolean };
  /** Text of the confirm button. Default: the label. */
  confirmLabel?: string;
  danger?: boolean;
  /** Show the "this cannot be edited later" line. Default true: money postings are final. */
  final?: boolean;
  successMessage?: string;
  redirectTo?: string;
}

/** Asks before money moves: the amount, a reason, and a plain line that it cannot be edited later. */
export function ConfirmMoney({ action, values = {}, label, title, amountPaise, consequence, reason = {}, confirmLabel, danger, final = true, successMessage = "Done", redirectTo }: ConfirmMoneyProps) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const id = useId();
  const needsReason = reason !== false && reason.required !== false;

  const run = () => {
    if (needsReason && !why.trim()) { setError("Say why."); return; }
    start(async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(values)) fd.set(k, v);
      fd.set("amountPaise", String(amountPaise));
      if (reason !== false) fd.set("reason", why.trim());
      const r = await action(fd);
      if (r.ok) { setOpen(false); setWhy(""); toast(r.message ?? successMessage); if (redirectTo) router.push(redirectTo); else router.refresh(); }
      else setError(r.error);
    });
  };

  return (
    <>
      <Button type="button" variant="secondary" className="rounded-full" onClick={() => { setError(""); setOpen(true); }}>{label}</Button>
      <Modal open={open} onOpenChange={setOpen} size="sm" title={title ?? label} tone={danger ? "danger" : undefined}
        footer={<ModalFooter danger={danger} secondary={{ onClick: () => setOpen(false) }} primary={{ label: confirmLabel ?? label, onClick: run, loading: pending }} />}>
        <div className="flex flex-col gap-4 pt-2">
          <div>
            <p className="text-xs text-[var(--ds-on-surface-muted)]">Amount</p>
            <Money paise={amountPaise} size="xl" />
            {consequence ? <p className="mt-2 text-sm text-[var(--ds-on-surface-variant)]">{consequence}</p> : null}
          </div>
          {reason !== false ? (
            <ModalField label={reason.label ?? "Reason"} htmlFor={`${id}-why`} required={needsReason} error={error || undefined}>
              <textarea id={`${id}-why`} rows={3} value={why} onChange={(e) => { setWhy(e.target.value); setError(""); }} aria-invalid={error ? true : undefined} className={`${INPUT} h-auto py-2`} />
            </ModalField>
          ) : error ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{error}</p> : null}
          {final ? <p className="text-xs text-[var(--ds-on-surface-muted)]">This cannot be edited later. A mistake is fixed with a new entry.</p> : null}
        </div>
      </Modal>
    </>
  );
}
