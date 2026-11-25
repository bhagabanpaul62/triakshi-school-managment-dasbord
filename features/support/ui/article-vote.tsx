"use client";

import { useState, useTransition } from "react";
import { IconThumbDown, IconThumbUp } from "@tabler/icons-react";
import { PILL_BTN } from "@smw/ui/finance/ui";
import type { FormResult } from "@smw/ui/shell/FormModal";

/** "Was this useful?" One tap, no person stored. */
export function ArticleVote({ slug, action }: { slug: string; action: (fd: FormData) => Promise<FormResult> }) {
  const [done, setDone] = useState<null | boolean>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const vote = (useful: boolean) => start(async () => {
    const fd = new FormData(); fd.set("article", slug); fd.set("useful", useful ? "true" : "false");
    const r = await action(fd);
    if (r.ok) { setDone(useful); setError(null); } else setError(r.error);
  });
  if (done !== null) return <p role="status" className="text-sm text-[var(--ds-on-surface-variant)]">{done ? "Thank you. Glad it helped." : "Thank you. If you are still stuck, ask us below and we will fix this article."}</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-[var(--ds-on-surface-variant)]">Was this useful?</span>
      <button type="button" disabled={pending} onClick={() => vote(true)} className={PILL_BTN}><IconThumbUp className="h-4 w-4" aria-hidden />Yes</button>
      <button type="button" disabled={pending} onClick={() => vote(false)} className={PILL_BTN}><IconThumbDown className="h-4 w-4" aria-hidden />No</button>
      {error ? <span role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{error}</span> : null}
    </div>
  );
}
