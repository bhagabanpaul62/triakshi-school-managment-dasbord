"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { IconPlus } from "@tabler/icons-react";
import { Modal, ModalFooter } from "@smw/ui/kit/Modal";
import { IconChip } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { FieldGrid, keepValues, type Field, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { MenuIconView } from "@smw/ui/shell/icons";
import { ageHint, Hint, OpenRecord, type AgeInfo } from "./admit-notes";

/**
 * FormModal plus what a student dialog needs: a list of what the action does, a live class-age hint, and "Open their record"
 * when a refusal names the same child. Everything else (fields, errors, toast, refresh) is the same as FormModal.
 */
export function StudentModal({ title, icon = "users", fields, values, hidden, action, submitLabel = "Save", effects, intro, age, trigger, danger, redirectTo, size, extra, blocked, onFormChange, onOpen }: {
  title: string; icon?: string; fields: Field[]; values?: Record<string, unknown>; hidden?: Record<string, string>;
  action: (fd: FormData) => Promise<FormResult>; submitLabel?: string;
  /** What this will do, one plain sentence each. */
  effects?: string[]; intro?: string; age?: AgeInfo; danger?: boolean; redirectTo?: string; size?: "sm" | "md" | "lg";
  /** What the office should see before pressing: open items, bills, links. Shown above the fields. */
  extra?: ReactNode;
  /** The plain reason this cannot be done now. It is said up front and the main button is off, so no press ends in a refusal. */
  blocked?: string | null;
  /** Called with the form as it changes (the page can show what the typed values mean, live). */
  onFormChange?: (fd: FormData) => void;
  onOpen?: () => void;
  trigger?: { label: string; variant?: "default" | "secondary" | "ghost"; plus?: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hint, setHint] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const formId = useId();
  const submit = (fd: FormData) => start(async () => {
    for (const [k, v] of Object.entries(hidden ?? {})) fd.set(k, v);
    const r = await action(fd);
    if (r.ok) { setErrors({}); setOpen(false); toast(r.message ?? "Saved"); if (redirectTo) router.push(redirectTo); else router.refresh(); }
    else { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); }
  });
  return (
    <>
      <Button onClick={() => { setErrors({}); onOpen?.(); setOpen(true); }} variant={trigger?.variant ?? "default"} className="rounded-full">
        {(trigger?.plus ?? !trigger) ? <IconPlus className="mr-1.5 h-4 w-4" aria-hidden /> : null}{trigger?.label ?? title}
      </Button>
      <Modal open={open} onOpenChange={setOpen} size={size ?? (fields.length > 6 ? "lg" : "md")} title={title} tone={danger ? "danger" : undefined}
        icon={<IconChip className="h-10 w-10"><MenuIconView name={icon} /></IconChip>} dismissOnOutsideClick={false}
        footer={<ModalFooter danger={danger} secondary={{ onClick: () => setOpen(false) }} primary={{ label: submitLabel, type: "submit", form: formId, loading: pending, disabled: !!blocked }} />}>
        <form id={formId} onSubmit={keepValues(submit)} onChange={age || onFormChange ? (e) => { const fd = new FormData(e.currentTarget); if (age) setHint(ageHint(fd, age)); onFormChange?.(fd); } : undefined} className="flex flex-col gap-5 pt-2" noValidate>
          {intro ? <p className="text-sm text-[var(--ds-on-surface-variant)]">{intro}</p> : null}
          {effects?.length ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--ds-on-surface-variant)]">{effects.map((e) => <li key={e}>{e}</li>)}</ul>
          ) : null}
          {blocked ? <p role="alert" className="rounded-2xl bg-[var(--ds-color-warning-500)]/10 px-4 py-3 text-sm text-[var(--ds-color-warning-300)]">{blocked}</p> : null}
          {extra}
          <Hint text={hint} />
          <FieldGrid fields={fields} values={values} errors={errors} />
          <OpenRecord href={errors._open} />
        </form>
      </Modal>
    </>
  );
}
