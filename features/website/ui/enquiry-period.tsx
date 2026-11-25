"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { INPUT } from "@smw/ui/shell/FormModal";

/** From, to and session of a screen, kept in the address. */
export function EnquiryPeriod({ sessions }: { sessions: string[] }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v); else next.delete(k);
    next.delete("page");
    start(() => router.replace(`${path}?${next.toString()}`, { scroll: false }));
  };
  const cls = `${INPUT} w-auto`;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <label className="flex items-center gap-2 text-sm text-[var(--ds-on-surface-muted)]">From<input type="date" value={params.get("from") ?? ""} max={params.get("to") ?? undefined} onChange={(e) => set("from", e.target.value)} className={cls} /></label>
      <label className="flex items-center gap-2 text-sm text-[var(--ds-on-surface-muted)]">To<input type="date" value={params.get("to") ?? ""} min={params.get("from") ?? undefined} onChange={(e) => set("to", e.target.value)} className={cls} /></label>
      {sessions.length ? (
        <label className="sr-only" htmlFor="enq-session">Session</label>
      ) : null}
      {sessions.length ? (
        <select id="enq-session" value={params.get("session") ?? ""} onChange={(e) => set("session", e.target.value)} className={cls}>
          <option value="">All sessions</option>
          {sessions.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      ) : null}
      {params.get("from") || params.get("to") || params.get("session") ? (
        <button type="button" onClick={() => { set("from", ""); set("to", ""); set("session", ""); }} className="text-sm text-[var(--ds-primary-text)] hover:underline">Clear</button>
      ) : null}
    </div>
  );
}
