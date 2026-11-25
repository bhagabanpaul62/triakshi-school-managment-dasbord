"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilesField } from "@smw/ui/comm/FilesField";
import { PersonLine } from "@smw/ui/comm/PersonLine";
import { INPUT, keepValues } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { cn } from "@smw/ui/utils";
import { MAX_FILE_MB, MAX_FILES, REVIEW_BANNER } from "../constants";
import { searchStaff, searchStudents, startThread } from "./actions";
import { PILL_BTN, PRIMARY_BTN } from "./styles";

type Hit = { id: string; name: string; label: string };
export interface NewMessageProps {
  family: boolean;
  children: { id: string; name: string }[];
  /** Family only: the child's teachers (by subject) and the office. */
  teachers: Hit[];
  canFiles: boolean;
  /** Start from a student (the "Message" link on a student). */
  student?: Hit;
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;

/** Search that never lets a slow old answer replace a newer one. */
function useSearch(run: (q: string) => Promise<Hit[]>) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Hit[] | null>(null);
  const latest = useRef(0);
  useEffect(() => {
    const n = ++latest.current;
    const t = setTimeout(async () => { const r = await run(q); if (n === latest.current) setFound(r); }, q ? 250 : 0);
    return () => clearTimeout(t);
    // run is a stable action wrapper
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  return { q, setQ, found };
}

function Chips({ items, onRemove, label }: { items: Hit[]; onRemove: (id: string) => void; label: string }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label={label}>
      {items.map((c) => (
        <li key={c.id}><button type="button" onClick={() => onRemove(c.id)} aria-label={`Remove ${c.name}`} className="rounded-full bg-[var(--ds-color-primary-500)]/20 px-3 py-1 text-sm hover:bg-[var(--ds-color-primary-500)]/30">{c.name} <span aria-hidden>×</span></button></li>
      ))}
    </ul>
  );
}

function Results({ found, chosen, onPick, none, label }: { found: Hit[] | null; chosen: string[]; onPick: (h: Hit) => void; none: string; label: string }) {
  const rows = (found ?? []).filter((h) => !chosen.includes(h.id));
  return (
    <ul className="custom-scrollbar max-h-48 overflow-y-auto rounded-2xl bg-white/[0.035] p-1" aria-label={label}>
      {found === null ? <li className="px-3 py-2 text-sm text-[var(--ds-on-surface-muted)]">Searching…</li> : null}
      {found && !rows.length ? <li className="px-3 py-2 text-sm text-[var(--ds-on-surface-muted)]">{none}</li> : null}
      {rows.map((h) => (
        <li key={h.id}><button type="button" onClick={() => onPick(h)} className="flex w-full items-center rounded-xl px-3 py-2 text-left hover:bg-white/[0.06]"><PersonLine name={h.name} sub={h.label} size="sm" /></button></li>
      ))}
    </ul>
  );
}

export function NewMessageForm(p: NewMessageProps) {
  const router = useRouter();
  const uid = useId();
  const [clientId] = useState(newId);
  const [mode, setMode] = useState<"family" | "staff">("family");
  const [student, setStudent] = useState<Hit | null>(p.student ?? null);
  const [people, setPeople] = useState<Hit[]>([]);
  const [childId, setChildId] = useState(p.children[0]?.id ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, run] = useTransition();
  const kids = useSearch(async (q) => { const r = await searchStudents(fd({ q })); return r.ok ? r.data.map((s) => ({ id: s.id, name: s.name, label: s.label })) : []; });
  const staff = useSearch(async (q) => { const r = await searchStaff(fd({ q })); return r.ok ? r.data.map((s) => ({ id: s.id, name: s.name, label: s.label })) : []; });

  const toStudent = !p.family && mode === "family";
  const submit = (data: FormData) => run(async () => {
    if (toStudent && student) data.set("studentId", student.id);
    if (p.family) data.set("studentId", childId);
    for (const c of people) data.append("recipientIds", c.id);
    data.set("clientId", clientId);
    const r = await startThread(data);
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); return toast(r.error, "danger"); }
    router.push(`/app/messages?thread=${(r.data as { id: string }).id}`);
  });
  const togglePerson = (h: Hit) => setPeople((cur) => (cur.some((x) => x.id === h.id) ? cur.filter((x) => x.id !== h.id) : [...cur, h]));
  const lbl = "text-sm text-[var(--ds-on-surface-variant)]";
  const err = (k: string) => (errors[k] ? <p role="alert" className="mt-1 text-xs text-[var(--ds-color-danger-400)]">{errors[k]}</p> : null);

  return (
    <form onSubmit={keepValues(submit)} className="mx-auto flex max-w-2xl flex-col gap-5" noValidate>
      {!p.family ? (
        <div role="radiogroup" aria-label="Who to write to" className="flex gap-2">
          {([["family", "A family, about a student"], ["staff", "Colleagues"]] as const).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => { setMode(k); setPeople([]); setErrors({}); }}
              className={cn(PILL_BTN, mode === k && "bg-[var(--ds-on-surface)] text-[var(--ds-surface)] hover:bg-[var(--ds-on-surface)]")}>{label}</button>
          ))}
        </div>
      ) : null}

      {toStudent ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${uid}-s`} className={lbl}>Which student is this about?</label>
          {student ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.05] p-3">
              <PersonLine name={student.name} sub={`${student.label}. The family is reached through this student.`} />
              <button type="button" onClick={() => setStudent(null)} className={PILL_BTN}>Change</button>
            </div>
          ) : (
            <>
              <input id={`${uid}-s`} value={kids.q} onChange={(e) => kids.setQ(e.target.value)} placeholder="Student name or admission number" autoComplete="off" className={INPUT} />
              <Results found={kids.found} chosen={[]} onPick={setStudent} label="Students you can write to" none={kids.q ? `No student named “${kids.q}” that you can write to.` : "No students found. You can write to the families of students you teach."} />
            </>
          )}
          {err("studentId")}
        </div>
      ) : null}

      {p.family ? (
        <>
          {p.children.length > 1 ? (
            <div><label htmlFor={`${uid}-c`} className={lbl}>Which child is this about?</label>
              <select id={`${uid}-c`} value={childId} onChange={(e) => setChildId(e.target.value)} className={cn(INPUT, "mt-1")}>{p.children.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select>{err("studentId")}</div>
          ) : null}
          <fieldset className="flex flex-col gap-2">
            <legend className={lbl}>Who do you want to write to?</legend>
            {p.teachers.length ? p.teachers.map((t) => (
              <label key={t.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl bg-white/[0.04] px-3 py-2 hover:bg-white/[0.07]">
                <input type="checkbox" checked={people.some((x) => x.id === t.id)} onChange={() => togglePerson(t)} className="h-4 w-4" />
                <PersonLine name={t.name} sub={t.label} size="sm" />
              </label>
            )) : <p className="text-sm text-[var(--ds-on-surface-muted)]">No teacher is listed for your child yet. Ask the school office to set up the class.</p>}
            {err("recipientIds")}
          </fieldset>
        </>
      ) : null}

      {!p.family && mode === "staff" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`${uid}-p`} className={lbl}>To</label>
          <Chips items={people} onRemove={(id) => setPeople((c) => c.filter((x) => x.id !== id))} label="Selected colleagues" />
          <input id={`${uid}-p`} value={staff.q} onChange={(e) => staff.setQ(e.target.value)} placeholder="Search by name" autoComplete="off" className={INPUT} />
          <Results found={staff.found} chosen={people.map((x) => x.id)} onPick={(h) => togglePerson(h)} label="Colleagues you can write to" none={staff.q ? `No one named “${staff.q}”.` : "No one left to add."} />
          {err("recipientIds")}
        </div>
      ) : null}

      <div>
        <label htmlFor={`${uid}-subject`} className={lbl}>Subject</label>
        <input id={`${uid}-subject`} name="subject" required maxLength={120} className={cn(INPUT, "mt-1")} aria-invalid={!!errors.subject || undefined} />{err("subject")}
      </div>
      <div>
        <label htmlFor={`${uid}-text`} className={lbl}>Message</label>
        <textarea id={`${uid}-text`} name="text" required rows={6} maxLength={4000} className={cn(INPUT, "mt-1 h-auto py-2")} aria-invalid={!!errors.body || undefined} />{err("body")}
      </div>
      {p.canFiles ? <FilesField accept={["application/pdf", "image/*"]} maxCount={MAX_FILES} maxMb={MAX_FILE_MB} /> : null}
      {err("files")}
      {!p.family || p.teachers.length ? (
        <p className="text-xs text-[var(--ds-on-surface-muted)]">{toStudent || p.family ? REVIEW_BANNER : "Staff conversations are private to the people in them."}</p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Link href="/app/messages" className={PILL_BTN}>Cancel</Link>
        <button type="submit" disabled={pending || (toStudent && !student) || (!toStudent && !people.length)} className={PRIMARY_BTN}>{pending ? "Sending…" : "Send"}</button>
      </div>
    </form>
  );
}

function fd(o: Record<string, string>) { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; }
