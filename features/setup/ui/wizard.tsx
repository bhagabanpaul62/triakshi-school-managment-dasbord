"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { FieldGrid, type Field, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { skipStep } from "./actions";

/**
 * Run one server action from a step: a toast on success or failure, field errors back to the form,
 * and `router.push(next)` when it worked. Returns the action's data to the caller through `onOk`.
 */
export function useStepRun(next?: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const run = (action: () => Promise<FormResult>, onOk?: (data: unknown) => boolean | void) => start(async () => {
    const r = await action();
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); return; }
    setErrors({});
    toast(r.message ?? "Saved");
    // onOk may return false to stay on the step (for example when some rows failed).
    if (onOk?.(r.data) === false) { router.refresh(); return; }
    if (next) router.push(next);
  });
  return { pending, errors, run };
}

/** "Do later": remembered for the school so resuming does not bring the step back, then on to the next one. Works on any /app/setup/<step> page. */
function DoLater({ next }: { next: string }) {
  const router = useRouter();
  const step = /^\/app\/setup\/([a-z]+)$/.exec(usePathname())?.[1];
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => {
        // A refused skip says so and stays: the step would otherwise come back as the next one with no word why.
        const r = step ? await skipStep({ step }) : null;
        if (r && !r.ok) { toast(r.error, "danger"); return; }
        router.push(next);
      })}
      className="flex min-h-10 items-center justify-center px-3 text-sm text-[var(--ds-on-surface-variant)] hover:text-[var(--ds-on-surface)]">Do later</button>
  );
}

/** Back on the left; "Do later" and the main button on the right (a submit button unless `onClick` is given). Stacks on a phone with the main button on top. */
export function StepFooter({ back, skip, label, pending, disabled, summary, onClick }: {
  back?: string | null; skip?: string; label: string; pending?: boolean; disabled?: boolean; summary?: ReactNode; onClick?: () => void;
}) {
  return (
    <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4 text-sm">
        {back ? <Link href={back} className="flex min-h-10 items-center text-[var(--ds-on-surface-variant)] hover:text-[var(--ds-on-surface)]">Back</Link> : null}
        {summary ? <span className="text-[var(--ds-on-surface-muted)]">{summary}</span> : null}
      </div>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        {skip ? <DoLater next={skip} /> : null}
        <Button type={onClick ? "button" : "submit"} onClick={onClick} disabled={disabled || pending} isLoading={pending} className="rounded-full px-6">{label}</Button>
      </div>
    </div>
  );
}

/** A whole step that is just a list of fields (profile, academic year). */
export function StepForm({ fields, values, action, next, back, skip, label = "Save and continue" }: {
  fields: Field[]; values?: Record<string, unknown>; action: (fd: FormData) => Promise<FormResult>; next: string; back?: string | null; skip?: string; label?: string;
}) {
  const { pending, errors, run } = useStepRun(next);
  return (
    <form action={(fd) => run(() => action(fd))} noValidate>
      <FieldGrid fields={fields} values={values} errors={errors} />
      <StepFooter back={back} skip={skip} label={label} pending={pending} />
    </form>
  );
}
