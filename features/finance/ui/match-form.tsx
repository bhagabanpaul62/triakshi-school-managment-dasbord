"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { Money } from "@smw/ui/finance/Money";
import { shortDate } from "@smw/ui/format";
import type { FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";

export interface Candidate { lineId: string; number: string; date: string; memo: string; amountPaise: number; why?: string[]; journalHref: string }

/** Pick the entries a bank line settles. One is the normal case; several is a split deposit. The total is shown against the bank line before anything is saved. */
export function MatchForm({ bankLineId, amountPaise, groups, action, doneHref }: { bankLineId: string; amountPaise: number; groups: { title: string; items: Candidate[] }[]; action: (fd: FormData) => Promise<FormResult>; doneHref: string }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(groups[0]?.items[0] && groups[0].title === "Best fits" ? [groups[0].items[0].lineId] : []));
  const [pending, start] = useTransition();
  const router = useRouter();
  const all = groups.flatMap((g) => g.items);
  const sum = all.filter((c) => picked.has(c.lineId)).reduce((s, c) => s + c.amountPaise, 0);
  const diff = amountPaise - sum, ready = picked.size > 0 && diff === 0;
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (!n.delete(id)) n.add(id); return n; });
  const submit = () => start(async () => {
    const fd = new FormData();
    fd.set("bankLineId", bankLineId);
    for (const id of picked) fd.append("entry", id);
    const r = await action(fd);
    if (r.ok) { toast(picked.size > 1 ? `Split deposit matched to ${picked.size} entries` : "Matched"); router.push(doneHref); router.refresh(); } else toast(r.error, "danger");
  });
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => g.items.length ? (
        <fieldset key={g.title} className="flex flex-col gap-1">
          <legend className="pb-2 text-[15px] font-medium">{g.title}</legend>
          {g.items.map((c) => (
            <label key={c.lineId} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-sm hover:bg-white/[0.04] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--ds-primary)]">
              <input type="checkbox" checked={picked.has(c.lineId)} onChange={() => toggle(c.lineId)} className="h-4 w-4 shrink-0 accent-[var(--ds-primary)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{c.memo}</span>
                <span className="block truncate font-mono text-xs text-[var(--ds-on-surface-muted)]">{c.number} · {shortDate(c.date)}{c.why?.length ? ` · ${c.why.join(", ")}` : ""}</span>
              </span>
              <Money paise={c.amountPaise} sign="always" />
            </label>
          ))}
        </fieldset>
      ) : null)}
      <div className="sticky bottom-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--ds-surface-container-high)] p-4" aria-live="polite">
        <p className="text-sm">
          Bank line <Money paise={amountPaise} sign="always" /> · picked <Money paise={sum} sign="always" />
          <span className={`ml-2 text-xs ${diff === 0 && picked.size ? "text-[var(--ds-color-success-400)]" : "text-[var(--ds-on-surface-muted)]"}`}>{picked.size === 0 ? "Pick the entry or entries." : diff === 0 ? "Adds up exactly." : <>{diff > 0 ? "Still to add" : "Too much by"} <Money paise={Math.abs(diff)} size="sm" /></>}</span>
        </p>
        <Button type="button" className="rounded-full" disabled={!ready} isLoading={pending} onClick={submit}>{picked.size > 1 ? "Match as split deposit" : "Match"}</Button>
      </div>
    </div>
  );
}
