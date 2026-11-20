"use client";

import { useRef } from "react";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ModalField } from "@smw/ui/kit/Modal";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { cn } from "@smw/ui/utils";
import { useActionForm } from "./use-action-form";
import { commentFields } from "./fields";

export interface ThreadMessage { id: string; author: string; mine: boolean; body: string; when: string; edited?: boolean; canEdit?: boolean; canDelete?: boolean }

/** One submission's thread: the messages so far and a box to reply. The teacher and the student both use it. */
export function CommentThread({ submissionId, messages, action, editAction, deleteAction }: {
  submissionId: string; messages: ThreadMessage[]; action: (fd: FormData) => Promise<FormResult>;
  editAction?: (fd: FormData) => Promise<FormResult>; deleteAction?: (fd: FormData) => Promise<FormResult>;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { errors, pending, submit } = useActionForm(action, () => { if (ref.current) ref.current.value = ""; });

  return (
    <div className="flex flex-col gap-3">
      {messages.length === 0 ? <p className="text-sm text-[var(--ds-on-surface-muted)]">No messages yet.</p> : (
        <ul className="flex flex-col gap-2">
          {messages.map((m) => (
            <li key={m.id} className={cn("flex flex-col gap-0.5 rounded-2xl px-3 py-2", m.mine ? "bg-white/[0.06]" : "bg-white/[0.03]")}>
              <span className="text-xs text-[var(--ds-on-surface-muted)]">{m.author} · {m.when}{m.edited ? " · edited" : ""}</span>
              <p className="whitespace-pre-wrap break-words text-sm text-[var(--ds-on-surface)]">{m.body}</p>
              {(m.canEdit && editAction) || (m.canDelete && deleteAction) ? (
                <span className="flex gap-1">
                  {m.canEdit && editAction ? <FormModal title="Edit comment" icon="assignment" fields={commentFields} values={{ body: m.body }} hidden={{ commentId: m.id }} action={editAction} trigger={{ label: "Edit", variant: "ghost", size: "sm" }} /> : null}
                  {m.canDelete && deleteAction ? <ActionButton variant="ghost" label="Delete" action={deleteAction} values={{ commentId: m.id }} successMessage="Comment deleted"
                    confirm={{ title: "Delete this comment?", body: "It is removed for everyone.", confirmLabel: "Delete", danger: true }} /> : null}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <form action={submit} className="flex flex-col gap-2" noValidate>
        <input type="hidden" name="submissionId" value={submissionId} />
        <ModalField label="Message" htmlFor={`comment-${submissionId}`} error={errors.body}>
          <textarea ref={ref} id={`comment-${submissionId}`} name="body" rows={2} placeholder="Write a comment" aria-invalid={errors.body ? true : undefined} className={cn(INPUT, "h-auto py-2")} />
        </ModalField>
        <div><Button type="submit" variant="secondary" className="rounded-full" isLoading={pending}>Send</Button></div>
      </form>
    </div>
  );
}
