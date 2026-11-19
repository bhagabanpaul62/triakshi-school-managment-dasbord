"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";

/** Message box under a ticket thread. Posts to a server action, then refreshes the thread. Ctrl/Cmd+Enter sends. */
export function ReplyForm({ ticketId, action, label = "Send reply" }: { ticketId: string; action: (fd: FormData) => Promise<FormResult>; label?: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const submit = (fd: FormData) => start(async () => {
    fd.set("id", ticketId);
    const r = await action(fd);
    if (r.ok) { ref.current?.reset(); setError(null); toast(r.message ?? "Sent"); router.refresh(); }
    else setError(r.fieldErrors?.body ?? r.error);
  });
  return (
    <form ref={ref} action={submit} className="flex flex-col gap-3" noValidate>
      <label htmlFor="reply-body" className="sr-only">Your reply</label>
      <textarea id="reply-body" name="body" rows={4} required placeholder="Write your reply" aria-invalid={error ? true : undefined} aria-describedby={error ? "reply-error" : undefined}
        onChange={() => error && setError(null)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ref.current?.requestSubmit(); } }}
        className={`${INPUT} h-auto py-2`} />
      {error ? <p id="reply-error" role="alert" className="text-sm text-[var(--ds-color-danger-500)]">{error}</p> : null}
      <div className="flex items-center justify-between gap-3">
        <span className="hidden text-xs text-[var(--ds-on-surface-muted)] sm:block">Ctrl + Enter to send</span>
        <Button type="submit" className="h-10 rounded-full" isLoading={pending}>{label}</Button>
      </div>
    </form>
  );
}
