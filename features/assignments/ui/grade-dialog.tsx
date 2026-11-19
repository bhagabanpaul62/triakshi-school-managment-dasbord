"use client";

import { useId, useState } from "react";
import { Modal, ModalFooter, ModalSection } from "@smw/ui/kit/Modal";
import { IconChip } from "@smw/ui/kit/Panel";
import { ToneBadge, type Tone } from "@smw/ui/widgets/WidgetPrimitives";
import { FieldGrid, type Field, type FormResult } from "@smw/ui/shell/FormModal";
import { MenuIconView } from "@smw/ui/shell/icons";
import { Button } from "@smw/ui/ui/button";
import { useActionForm } from "./use-action-form";

export interface GradeDialogProps {
  submissionId: string;
  studentName: string;
  /** "Handed in 18 Nov, 4:10 pm" */
  submittedLabel: string;
  statusLabel: string;
  statusTone: Tone;
  text: string | null;
  files: { id: string; fileName: string; sizeLabel: string; url: string }[];
  fields: Field[];
  values: Record<string, unknown>;
  /** "Grade" for new work, "Edit grade" once graded. */
  triggerLabel: string;
  action: (fd: FormData) => Promise<FormResult>;
}

/** Read what a student handed in and mark it, in one dialog: the answer sits beside the grade form. */
export function GradeDialog(p: GradeDialogProps) {
  const [open, setOpen] = useState(false);
  const formId = useId();
  const { errors, pending, submit, clearErrors } = useActionForm(p.action, () => setOpen(false));

  return (
    <>
      <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={() => { clearErrors(); setOpen(true); }} aria-label={`${p.triggerLabel}: ${p.studentName}`}>{p.triggerLabel}</Button>
      <Modal open={open} onOpenChange={setOpen} size="xl" title={p.studentName} description={p.submittedLabel} dismissOnOutsideClick={false}
        icon={<IconChip className="h-10 w-10"><MenuIconView name="assignment" /></IconChip>}
        aside={
          <ModalSection title="Their work">
            <ToneBadge label={p.statusLabel} tone={p.statusTone} className="w-fit" />
            {p.text ? <p className="whitespace-pre-wrap break-words text-sm text-[var(--ds-on-surface)]">{p.text}</p> : <p className="text-sm text-[var(--ds-on-surface-muted)]">No written answer.</p>}
            {p.files.length ? (
              <ul className="flex flex-col gap-1">
                {p.files.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 text-sm">
                    <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-[var(--ds-color-primary-300)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]" title={`Open ${f.fileName}`}>{f.fileName}</a>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{f.sizeLabel}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </ModalSection>
        }
        footer={<ModalFooter secondary={{ onClick: () => setOpen(false) }} primary={{ label: "Save", type: "submit", form: formId, loading: pending }} />}>
        <form id={formId} action={submit} className="pt-2" noValidate>
          <input type="hidden" name="id" value={p.submissionId} />
          <FieldGrid fields={p.fields} values={p.values} errors={errors} columns={1} />
        </form>
      </Modal>
    </>
  );
}
