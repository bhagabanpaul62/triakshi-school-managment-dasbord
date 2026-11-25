"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconDownload } from "@tabler/icons-react";
import { PersonLine } from "@smw/ui/comm/PersonLine";
import { StateChip } from "@smw/ui/comm/StateChip";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { PILL as PILL_BTN } from "./styles";
import { cn } from "@smw/ui/utils";
import { answerForPerson, checkInPerson } from "./actions";

export interface ListRow { key: string; name: string; label: string; answer: "yes" | "maybe" | "no" | null; guests: number; waiting: boolean; checkedIn: boolean }
type Filter = "all" | "going" | "waiting" | "maybe" | "no" | "none";
const state = (r: ListRow) => (r.answer === "yes" ? (r.waiting ? "no_reply" : "going") : r.answer === "maybe" ? "maybe" : r.answer === "no" ? "not_going" : "no_reply");
const FILTERS: [Filter, string][] = [["all", "Everyone"], ["going", "Going"], ["waiting", "Waiting"], ["maybe", "Maybe"], ["no", "Not going"], ["none", "No answer"]];
const PAGE = 100;

/** The list for the person who runs the event: answers, answer on someone's behalf, arrived marks, CSV. */
export function RsvpList({ eventId, rows: initial, csvHref, live }: { eventId: string; rows: ListRow[]; csvHref: string; live: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [, start] = useTransition();

  const kept = useMemo(() => {
    const text = q.trim().toLowerCase();
    return rows.filter((r) => (filter === "all" || (filter === "going" && r.answer === "yes" && !r.waiting) || (filter === "waiting" && r.waiting) || (filter === "maybe" && r.answer === "maybe") || (filter === "no" && r.answer === "no") || (filter === "none" && !r.answer))
      && (!text || r.name.toLowerCase().includes(text) || r.label.toLowerCase().includes(text)));
  }, [rows, filter, q]);

  const patch = (key: string, p: Partial<ListRow>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const checkIn = (r: ListRow) => {
    patch(r.key, { checkedIn: !r.checkedIn });
    start(async () => {
      const fd = new FormData(); fd.set("id", eventId); fd.set("key", r.key); fd.set("on", String(!r.checkedIn));
      const res = await checkInPerson(fd);
      if (!res.ok) { patch(r.key, { checkedIn: r.checkedIn }); toast(res.error, "danger"); }
    });
  };
  const answer = (r: ListRow, a: "yes" | "no") => {
    start(async () => {
      const fd = new FormData(); fd.set("id", eventId); fd.set("key", r.key); fd.set("answer", a);
      const res = await answerForPerson(fd);
      if (!res.ok) { toast(res.error, "danger"); return; }
      patch(r.key, { answer: a, guests: 0, waiting: res.data === "waiting" });
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} placeholder="Search by name or class" aria-label="Search people" className={cn(INPUT, "w-full sm:w-64")} />
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => { setFilter(k); setShown(PAGE); }}
              className={cn("min-h-9 rounded-full px-3 text-xs font-medium", filter === k ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary)]" : "bg-white/[0.07] text-[var(--ds-on-surface-variant)] hover:bg-white/[0.12]")}>{label}</button>
          ))}
        </div>
        <a href={csvHref} className={cn(PILL_BTN, "ml-auto")}><IconDownload className="h-4 w-4" aria-hidden />Download CSV</a>
      </div>
      {kept.length === 0 ? <p className="rounded-2xl bg-white/[0.035] p-6 text-sm text-[var(--ds-on-surface-variant)]">{rows.length ? "Nobody matches. Clear the search or pick Everyone." : "Nobody is invited yet."}</p> : (
        <ul className="flex flex-col gap-1.5">
          {kept.slice(0, shown).map((r) => (
            <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-white/[0.04] p-2 pr-3">
              <PersonLine name={r.name} sub={r.label} size="sm" className="min-w-0 flex-1 basis-48" />
              <span className="flex items-center gap-2">
                <StateChip kind="rsvp" state={state(r)} />
                {r.waiting ? <span className="text-xs text-[var(--ds-on-surface-muted)]">Waiting list</span> : null}
                {r.guests ? <span className="text-xs tabular-nums text-[var(--ds-on-surface-muted)]">+{r.guests}</span> : null}
              </span>
              <span className="flex items-center gap-1.5">
                {!r.answer ? (
                  <>
                    <button type="button" onClick={() => answer(r, "yes")} className="min-h-9 rounded-full bg-white/[0.07] px-3 text-xs hover:bg-white/[0.12]" aria-label={`Mark ${r.name} as coming`}>Coming</button>
                    <button type="button" onClick={() => answer(r, "no")} className="min-h-9 rounded-full bg-white/[0.07] px-3 text-xs hover:bg-white/[0.12]" aria-label={`Mark ${r.name} as not coming`}>Not coming</button>
                  </>
                ) : null}
                {live ? <button type="button" aria-pressed={r.checkedIn} onClick={() => checkIn(r)} className={cn("min-h-9 rounded-full px-3 text-xs font-medium", r.checkedIn ? "bg-[var(--ds-primary)] text-[var(--ds-on-primary)]" : "bg-white/[0.07] hover:bg-white/[0.12]")}>{r.checkedIn ? "Arrived" : "Mark arrived"}</button> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {kept.length > shown ? <button type="button" onClick={() => setShown((n) => n + PAGE)} className={PILL_BTN}>Show {Math.min(PAGE, kept.length - shown)} more of {kept.length - shown}</button> : null}
    </div>
  );
}
