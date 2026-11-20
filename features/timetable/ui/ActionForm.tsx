"use client";

import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";
import type { FormResult } from "@smw/ui/shell/FormModal";

/**
 * A plain form behind one server action: toast on the result, then refresh. With `goTo`, a successful result
 * whose data has `idKey` sends the person to `${goTo}${id}` (the draft that was just built).
 */
export function ActionForm({ action, children, submitLabel, goTo, next, idKey = "versionId", disabled, className }: {
  action: (fd: FormData) => Promise<FormResult>;
  children?: ReactNode;
  submitLabel: string;
  goTo?: string;
  /** Where to go after any success (the next wizard step). */
  next?: string;
  idKey?: string;
  disabled?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <form className={className ?? "flex flex-col gap-3"} onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      start(async () => {
        const r = await action(fd);
        if (!r.ok) { toast(r.error, "danger"); return; }
        toast(r.message ?? "Saved");
        const id = goTo && r.data && typeof r.data === "object" ? (r.data as Record<string, unknown>)[idKey] : null;
        if (goTo && typeof id === "string") router.push(`${goTo}${id}`); else if (next) router.push(next); else router.refresh();
      });
    }}>
      {children}
      <div><Button type="submit" className="rounded-full" isLoading={pending} disabled={disabled}>{submitLabel}</Button></div>
    </form>
  );
}
