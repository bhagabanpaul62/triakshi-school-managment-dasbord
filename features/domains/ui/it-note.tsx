"use client";

import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";

/** "Send to my IT person": the message to read, copy, or open in the mail program. */
export function ItNote({ subject, body }: { subject: string; body: string }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(body); toast("Message copied"); } catch { toast("Could not copy. Select the text and copy it by hand.", "danger"); }
  };
  return (
    <div className="flex flex-col gap-3">
      <textarea readOnly aria-label="Message for your IT person" value={body} rows={10} onFocus={(e) => e.currentTarget.select()}
        className="w-full resize-y rounded-xl bg-white/[0.04] p-3 font-mono text-xs text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]" />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" className="rounded-full" onClick={copy}>Copy message</Button>
        <Button asChild variant="ghost" className="rounded-full"><a href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>Open in my mail</a></Button>
      </div>
    </div>
  );
}
