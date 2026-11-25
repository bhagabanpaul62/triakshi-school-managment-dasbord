"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { Button } from "@smw/ui/ui/button";
import { HOLIDAY_KINDS } from "../constants";
import type { CopyProposal } from "../holiday-import";
import { dayLabel } from "../stats";

const weekday = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
export const rangeText = (from: string, to: string) => (from === to ? `${weekday(from)}, ${dayLabel(from)}` : `${dayLabel(from)} to ${dayLabel(to)}`);

/**
 * A list of proposed holidays to tick, then add in one go (all or nothing). Days that never move are ticked for you;
 * a day that moves each year starts unticked so the school checks the date. A day that already has a holiday cannot be ticked.
 */
export function HolidayPicker({ items, action, cta, today }: { items: CopyProposal[]; action: (fd: FormData) => Promise<FormResult>; cta: string; today: string }) {
  const router = useRouter();
  const [ticked, setTicked] = useState(() => new Set(items.flatMap((p, i) => (p.fixed && !p.clash ? [i] : []))));
  const [notify, setNotify] = useState(true);
  const [pending, start] = useTransition();
  const chosen = items.filter((_, i) => ticked.has(i));
  const upcoming = chosen.some((c) => c.data.from >= today);

  const toggle = (i: number) => setTicked((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const submit = () => start(async () => {
    const fd = new FormData();
    fd.set("items", JSON.stringify(chosen.map((c) => c.data)));
    if (notify && upcoming) fd.set("notify", "true");
    const r = await action(fd);
    if (r.ok) { toast(r.message ?? "Holidays added"); router.refresh(); } else toast(r.error, "danger");
  });

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1">
        {items.map((p, i) => (
          <li key={`${p.data.from}-${p.data.name}`}>
            <label className={`flex min-h-11 items-start gap-3 rounded-2xl px-3 py-2 text-sm ${p.clash ? "opacity-50" : "cursor-pointer hover:bg-white/[0.04]"}`}>
              <input type="checkbox" checked={ticked.has(i)} disabled={!!p.clash} onChange={() => toggle(i)} className="mt-1 h-4 w-4 shrink-0 accent-[var(--ds-primary)]" />
              <span className="min-w-0">
                <span className="block text-[var(--ds-on-surface)]">{p.data.name}</span>
                <span className="block text-xs text-[var(--ds-on-surface-muted)]">
                  {rangeText(p.data.from, p.data.to)} · {HOLIDAY_KINDS[p.data.kind]}
                  {p.clash ? ` · already a holiday (${p.clash})` : p.fixed ? "" : " · the date moves each year, check it"}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" className="rounded-full" onClick={submit} disabled={chosen.length === 0} isLoading={pending}>{cta}{chosen.length ? ` (${chosen.length})` : ""}</Button>
        {upcoming ? (
          <label className="flex items-center gap-2 text-sm text-[var(--ds-on-surface-variant)]">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 accent-[var(--ds-primary)]" />Tell the people it affects
          </label>
        ) : null}
      </div>
    </div>
  );
}
