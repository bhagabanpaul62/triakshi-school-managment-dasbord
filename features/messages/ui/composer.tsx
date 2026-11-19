"use client";

import { useRef, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { cn } from "@smw/ui/utils";

/** The reply box. Enter sends, Shift+Enter adds a line. The page refreshes on send (no polling). */
export function Composer({ threadId, action }: { threadId: string; action: (fd: FormData) => Promise<FormResult> }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const box = useRef<HTMLTextAreaElement>(null);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("threadId", threadId);
    start(async () => {
      const r = await action(fd);
      if (!r.ok) return toast(r.error, "danger");
      if (box.current) box.current.value = "";
      router.refresh();
    });
  };
  const enterSends = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
  };

  return (
    <form onSubmit={submit} className="flex items-end gap-2 pt-3">
      <label htmlFor="reply" className="sr-only">Write a reply</label>
      <textarea ref={box} id="reply" name="body" rows={1} maxLength={4000} required placeholder="Write a reply" onKeyDown={enterSends}
        className={cn(INPUT, "h-auto max-h-40 min-h-10 resize-none py-2")} />
      <Button type="submit" className="rounded-full" isLoading={pending}>Send</Button>
    </form>
  );
}
