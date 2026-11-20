"use client";

import { useState } from "react";
import { ModalField } from "@smw/ui/kit/Modal";
import { INPUT, type FormResult, keepValues } from "@smw/ui/shell/FormModal";
import { Button } from "@smw/ui/ui/button";
import { cn } from "@smw/ui/utils";
import { useActionForm } from "./use-action-form";

export interface GradableRow { submissionId: string; name: string; statusLabel: string }

/** Tick several students who handed in, then give them the same marks and/or feedback in one go. */
export function BulkGrade({ assignmentId, rows, maxMarks, action }: {
  assignmentId: string; rows: GradableRow[]; maxMarks: number | null; action: (fd: FormData) => Promise<FormResult>;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const { errors, pending, submit } = useActionForm(action, () => setPicked(new Set()));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = rows.length > 0 && picked.size === rows.length;

  return (
    <form onSubmit={keepValues(submit)} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-[var(--ds-on-surface-muted)]">{picked.size} of {rows.length} selected</span>
        <Button type="button" variant="ghost" size="sm" className="rounded-full" onClick={() => setPicked(all ? new Set() : new Set(rows.map((r) => r.submissionId)))}>
          {all ? "Clear" : "Select all"}
        </Button>
      </div>
      <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
        {rows.map((r) => (
          <li key={r.submissionId}>
            <label className="flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 text-sm transition-colors duration-150 hover:bg-white/[0.04]">
              <input type="checkbox" name="submissionId" value={r.submissionId} checked={picked.has(r.submissionId)} onChange={() => toggle(r.submissionId)} className="h-4 w-4 accent-[var(--ds-primary)]" />
              <span className="min-w-0 flex-1 truncate text-[var(--ds-on-surface)]">{r.name}</span>
              <span className="shrink-0 text-xs text-[var(--ds-on-surface-muted)]">{r.statusLabel}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {maxMarks == null ? null : (
          <ModalField label={`Marks out of ${maxMarks}`} htmlFor="bulk-marks" error={errors.marks} hint="Leave empty to keep each student's marks">
            <input id="bulk-marks" name="marks" type="number" min={0} max={maxMarks} aria-invalid={errors.marks ? true : undefined} className={cn(INPUT)} />
          </ModalField>
        )}
        <ModalField label="Feedback" htmlFor="bulk-feedback" error={errors.feedback || errors.submissionId} hint="Replaces each student's feedback" className={maxMarks == null ? "sm:col-span-2" : undefined}>
          <textarea id="bulk-feedback" name="feedback" rows={2} aria-invalid={errors.feedback || errors.submissionId ? true : undefined} className={cn(INPUT, "h-auto py-2")} />
        </ModalField>
      </div>
      <div>
        <Button type="submit" className="rounded-full" disabled={picked.size === 0} isLoading={pending}>
          {picked.size === 0 ? "Select students to grade" : `Grade ${picked.size} ${picked.size === 1 ? "student" : "students"}`}
        </Button>
      </div>
    </form>
  );
}
