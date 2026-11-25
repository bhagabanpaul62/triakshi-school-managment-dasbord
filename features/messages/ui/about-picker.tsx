"use client";

import { useEffect, useRef, useState } from "react";
import { INPUT } from "@smw/ui/shell/FormModal";
import { cn } from "@smw/ui/utils";
import { searchStaff } from "./actions";

type Person = { id: string; name: string };
const ROW = "flex min-h-10 items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2 text-sm";

/**
 * "Who is it about?" for a concern. The other people in the conversation (the only one is already ticked), "Someone else" with a staff search,
 * and "Not sure" (everyone else in it). Sends `aboutUserIds` (repeated) and `unsure`.
 */
export function AboutPicker({ others, studentId, error, onlyElse = false }: { others: Person[]; studentId: string | null; error?: string; onlyElse?: boolean }) {
  const [elseOn, setElseOn] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Person[]>([]);
  const [chosen, setChosen] = useState<Person[]>([]);
  const latest = useRef(0);
  useEffect(() => {
    const n = ++latest.current;
    if (!elseOn || q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      const f = new FormData(); f.set("q", q); if (studentId) f.set("studentId", studentId);
      const r = await searchStaff(f);
      if (n === latest.current && r.ok) setFound(r.data.map((p) => ({ id: p.id, name: p.name })).filter((p) => !chosen.some((c) => c.id === p.id) && !others.some((o) => o.id === p.id)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, elseOn, studentId, chosen, others]);

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={error ? "about-err" : undefined}>
      <legend className="text-sm text-[var(--ds-on-surface-variant)]">{onlyElse ? "Is it about someone else? (optional)" : "Who is it about?"}</legend>
      {onlyElse ? null : others.map((p) => (
        <label key={p.id} className={ROW}><input type="checkbox" name="aboutUserIds" value={p.id} defaultChecked={others.length === 1} />{p.name}</label>
      ))}
      <label className={ROW}><input type="checkbox" checked={elseOn} onChange={(e) => setElseOn(e.target.checked)} />Someone else</label>
      {elseOn ? (
        <div className="flex flex-col gap-2 pl-2">
          {chosen.map((p) => (
            <span key={p.id} className="flex items-center justify-between gap-2 rounded-2xl bg-white/[0.06] px-3 py-1.5 text-sm">
              <input type="hidden" name="aboutUserIds" value={p.id} />{p.name}
              <button type="button" className="underline" onClick={() => setChosen((c) => c.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.name}`}>Remove</button>
            </span>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for a staff member" aria-label="Search for a staff member" autoComplete="off" className={INPUT} />
          {found.length ? <ul className="rounded-2xl bg-white/[0.035] p-1" aria-label="Staff found">{found.map((p) => <li key={p.id}><button type="button" className="w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-white/[0.06]" onClick={() => { setChosen((c) => [...c, p]); setQ(""); setFound([]); }}>{p.name}</button></li>)}</ul> : null}
        </div>
      ) : null}
      {onlyElse ? null : <label className={cn(ROW)}><input type="checkbox" name="unsure" value="true" />Not sure (everyone else in it)</label>}
      {error ? <p id="about-err" role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{error}</p> : null}
    </fieldset>
  );
}
