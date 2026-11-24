"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@smw/ui/shell/toast";
import type { FormResult } from "@smw/ui/shell/FormModal";

/** The submit plumbing every custom form here shares with FormModal: pending state, field errors, toast, refresh. */
export function useActionForm(action: (fd: FormData) => Promise<FormResult>, onDone?: () => void) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();

  /** Use as `onSubmit={keepValues(submit)}`: typed values survive a refusal, and the form clears only on success. */
  const submit = (fd: FormData, reset?: () => void) => start(async () => {
    const r = await action(fd);
    if (r.ok) {
      setErrors({});
      reset?.();
      toast(r.message ?? "Saved");
      onDone?.();
      router.refresh();
    } else {
      setErrors(r.fieldErrors ?? {});
      toast(r.error, "danger");
    }
  });

  return { errors, pending, submit, clearErrors: () => setErrors({}) };
}
