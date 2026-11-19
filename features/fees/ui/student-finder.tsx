"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconSearch } from "@tabler/icons-react";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { initials, paise } from "@smw/ui/format";
import { findStudents } from "./actions";
import { STATUS_LABELS, STATUS_TONES } from "./fields";

type Hit = Awaited<ReturnType<typeof findStudents>>[number];

/** The counter's search: type a name or admission number, arrow to a student, Enter opens the ledger with the payment form ready. */
export function StudentFinder() {
  const router = useRouter();
  const id = useId();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); setFailed(false); return; }
    const mine = ++seq.current;
    setHits(null); setFailed(false);
    const t = setTimeout(() => {
      findStudents(term).then((r) => { if (mine === seq.current) { setHits(r); setActive(0); } }).catch(() => { if (mine === seq.current) setFailed(true); });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const open = (h: Hit) => router.push(`/app/fees/students/${h.id}${h.due ? "?pay=1" : ""}`);
  const term = q.trim();

  return (
    <div className="relative">
      <label htmlFor={`${id}-q`} className="sr-only">Find a student to collect fees</label>
      <div className="flex h-14 items-center gap-3 rounded-full bg-[var(--ds-surface-container-low)] px-5 focus-within:bg-[var(--ds-surface-container)]">
        <IconSearch className="h-5 w-5 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden />
        <input
          id={`${id}-q`} role="combobox" aria-expanded={term.length >= 2} aria-controls={`${id}-list`} aria-autocomplete="list" autoComplete="off" autoFocus
          value={q} onChange={(e) => setQ(e.target.value)} placeholder="Collect a fee: type a student's name or admission number"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && hits?.length) { e.preventDefault(); setActive((a) => (a + 1) % hits.length); }
            else if (e.key === "ArrowUp" && hits?.length) { e.preventDefault(); setActive((a) => (a - 1 + hits.length) % hits.length); }
            else if (e.key === "Enter" && hits?.[active]) { e.preventDefault(); open(hits[active]!); }
            else if (e.key === "Escape") setQ("");
          }}
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--ds-on-surface-muted)]"
        />
      </div>
      {term.length >= 2 ? (
        <ul id={`${id}-list`} role="listbox" aria-label="Matching students" className="absolute inset-x-0 top-16 z-20 flex flex-col rounded-3xl bg-[var(--ds-surface-container-highest)] p-2 shadow-lg">
          {failed ? <li className="px-4 py-3 text-sm text-[var(--ds-color-danger-300)]">Search failed. Check your connection and type again.</li>
            : hits === null ? <li className="px-4 py-3 text-sm text-[var(--ds-on-surface-muted)]">Searching...</li>
            : hits.length === 0 ? <li className="px-4 py-3 text-sm text-[var(--ds-on-surface-muted)]">No student matches &quot;{term}&quot;, or their class has no fees set yet.</li>
            : hits.map((h, i) => (
              <li key={h.id} role="option" aria-selected={i === active}>
                <button type="button" onClick={() => open(h)} onMouseEnter={() => setActive(i)}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] ${i === active ? "bg-white/[0.07]" : ""}`}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-xs" aria-hidden>{initials(h.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{h.name}</span>
                    <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{h.admissionNo} · {h.classLabel}</span>
                  </span>
                  <span className="text-sm tabular-nums">{h.due ? paise(h.due) : "-"}</span>
                  <ToneBadge label={STATUS_LABELS[h.status] ?? h.status} tone={STATUS_TONES[h.status] ?? "default"} />
                </button>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}
