"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";

/** Message box under a ticket thread: posts to a server action, then refreshes the thread. */
export function ReplyForm({ ticketId, action }: { ticketId: string; action: (fd: FormData) => Promise<FormResult> }) {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const submit = (fd: FormData) => start(async () => {
    fd.set("id", ticketId);
    const r = await action(fd);
    if (r.ok) { ref.current?.reset(); toast(r.message ?? "Sent"); router.refresh(); }
    else toast(r.fieldErrors?.body ?? r.error, "danger");
  });
  return (
    <form ref={ref} action={submit} className="flex flex-col gap-3" noValidate>
      <label htmlFor="reply-body" className="sr-only">Reply</label>
      <textarea id="reply-body" name="body" rows={4} required placeholder="Write a reply to the school" className={`${INPUT} h-auto py-2`} />
      <div className="flex justify-end"><Button type="submit" className="rounded-full" isLoading={pending}>Send reply</Button></div>
    </form>
  );
}
