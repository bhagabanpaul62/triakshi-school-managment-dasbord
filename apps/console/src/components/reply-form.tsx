"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { FilesField } from "@smw/ui/comm/FilesField";
import { filesTotalProblem } from "@smw/feature-kit/support-sla";
import { toast } from "@smw/ui/shell/toast";

/** Message box under a ticket thread: saved replies fill the box, files attach, and "solved" closes the loop. Posts to a server action, then refreshes the thread. */
export function ReplyForm({ ticketId, action, saved = [], label = "Send reply", placeholder = "Write a reply to the school", solveBox = false, files = true }: {
  ticketId: string; action: (fd: FormData) => Promise<FormResult>; saved?: { id: string; title: string; body: string }[];
  label?: string; placeholder?: string; solveBox?: boolean; files?: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const [pending, start] = useTransition();
  const [round, setRound] = useState(0);
  const router = useRouter();
  const uid = useId();
  const submit = (fd: FormData) => start(async () => {
    fd.set("id", ticketId);
    const tooMuch = filesTotalProblem(fd.getAll("files").map((f) => (f instanceof File ? f.size : 0)));
    if (tooMuch) { toast(tooMuch, "danger"); return; }
    const r = await action(fd);
    if (r.ok) { ref.current?.reset(); setRound((n) => n + 1); toast(r.message ?? "Sent"); router.refresh(); }
    else toast(r.fieldErrors?.body ?? r.fieldErrors?.files ?? r.error, "danger");
  });
  return (
    <form ref={ref} action={submit} className="flex flex-col gap-3" noValidate>
      {saved.length ? (
        <label className="flex items-center gap-2 text-sm text-[var(--ds-on-surface-variant)]">
          <span className="shrink-0">Saved reply</span>
          <select className={`${INPUT} h-10 max-w-xs`} defaultValue="" onChange={(e) => { const s = saved.find((x) => x.id === e.target.value); if (s && box.current) { box.current.value = box.current.value ? `${box.current.value}\n\n${s.body}` : s.body; box.current.focus(); } e.target.value = ""; }}>
            <option value="">Insert one...</option>
            {saved.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>
      ) : null}
      <label htmlFor={uid} className="sr-only">Message</label>
      <textarea ref={box} id={uid} name="body" rows={5} required placeholder={placeholder} className={`${INPUT} h-auto py-2`} />
      {files ? <FilesField key={round} label="Add a picture or PDF (optional)" accept={["application/pdf", "image/*"]} maxCount={5} maxMb={10} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {solveBox ? <label className="flex items-center gap-2 text-sm text-[var(--ds-on-surface-variant)]"><input type="checkbox" name="solve" value="true" className="h-4 w-4" />Also mark it solved</label> : <span />}
        <Button type="submit" className="rounded-full" isLoading={pending}>{label}</Button>
      </div>
    </form>
  );
}
