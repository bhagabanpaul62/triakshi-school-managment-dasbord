"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@smw/ui/kit/Panel";
import { INPUT, keepValues } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { cn } from "@smw/ui/utils";
import { deleteReply, saveReply } from "./actions";
import type { ReplyOption } from "./saved-replies";
import { PILL_BTN, PRIMARY_BTN } from "./styles";

/** Short answers a person types often. Mine are private; the office can share one with everybody. */
export function RepliesPanel({ replies, canShare }: { replies: (ReplyOption & { mine: boolean })[]; canShare: boolean }) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, run] = useTransition();
  return (
    <Panel title="Saved replies">
      <ul className="mb-4 flex flex-col gap-2">
        {replies.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-3 rounded-2xl bg-white/[0.04] p-3 text-sm">
            <span className="min-w-0"><span className="block">{r.title}{r.shared ? <span className="ml-2 text-xs text-[var(--ds-on-surface-muted)]">Shared by the office</span> : null}</span><span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{r.body}</span></span>
            {r.mine || canShare ? <button type="button" className={PILL_BTN} disabled={pending} onClick={() => run(async () => { const x = await deleteReply(r.id); if (x.ok) { toast("Reply deleted"); router.refresh(); } else toast(x.error, "danger"); })}>Delete</button> : null}
          </li>
        ))}
        {!replies.length ? <li className="text-sm text-[var(--ds-on-surface-muted)]">None yet. Add the answers you give again and again, then pick one in any conversation.</li> : null}
      </ul>
      <form noValidate onSubmit={keepValues((fd, reset) => run(async () => { const x = await saveReply(fd); if (x.ok) { reset(); setErrors({}); toast("Reply saved"); router.refresh(); } else { setErrors(x.fieldErrors ?? {}); toast(x.error, "danger"); } }))} className="flex flex-col gap-2">
        <input name="title" required maxLength={60} placeholder="Short title" aria-label="Title" className={INPUT} />
        {errors.title ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{errors.title}</p> : null}
        <textarea name="body" required rows={3} maxLength={4000} placeholder="The reply" aria-label="Reply" className={cn(INPUT, "h-auto py-2")} />
        {errors.body ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{errors.body}</p> : null}
        {canShare ? <label className="flex items-center gap-2 text-sm text-[var(--ds-on-surface-variant)]"><input type="checkbox" name="shared" />Share with everyone at the school</label> : null}
        <div><button type="submit" disabled={pending} className={PRIMARY_BTN}>Save reply</button></div>
      </form>
    </Panel>
  );
}
