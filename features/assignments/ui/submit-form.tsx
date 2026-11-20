"use client";

import { useRef } from "react";
import { ModalField } from "@smw/ui/kit/Modal";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { INPUT, type FormResult, keepValues } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { cn } from "@smw/ui/utils";
import { useActionForm } from "./use-action-form";

/** The student's hand-in form: an answer, up to five files, one button. Handing in again replaces the earlier answer. */
export function SubmitForm({ assignmentId, text, hasFiles, handedIn, pastDue, action }: {
  assignmentId: string; text: string | null; hasFiles: boolean; handedIn: boolean; pastDue: boolean; action: (fd: FormData) => Promise<FormResult>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { errors, pending, submit } = useActionForm(action, () => { if (fileRef.current) fileRef.current.value = ""; });

  return (
    <form onSubmit={keepValues(submit)} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      {pastDue ? <ToneBadge label="Past the due time: this will be marked late" tone="warning" className="w-fit" /> : null}
      <ModalField label="Your answer" htmlFor="submit-text" error={errors.text}>
        <textarea id="submit-text" name="text" rows={5} defaultValue={text ?? ""} placeholder="Type your answer, or attach your work below" aria-invalid={errors.text ? true : undefined} className={cn(INPUT, "h-auto py-2")} />
      </ModalField>
      <ModalField label="Files" htmlFor="submit-files" error={errors.files}
        hint={hasFiles ? "Choosing new files replaces the ones you handed in before." : "Up to 5 files: PDF, image, Word or Excel, 15 MB each."}>
        <input ref={fileRef} id="submit-files" name="files" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.csv,.docx,.xlsx"
          className={cn(INPUT, "py-2 file:mr-3 file:rounded-full file:border-0 file:bg-white/[0.08] file:px-3 file:text-[var(--ds-on-surface)]")} />
      </ModalField>
      <div><Button type="submit" className="rounded-full" isLoading={pending}>{handedIn ? "Hand in again" : "Hand in"}</Button></div>
    </form>
  );
}
