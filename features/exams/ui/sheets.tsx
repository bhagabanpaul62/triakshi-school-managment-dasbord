"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";

type Action = (fd: FormData) => Promise<FormResult>;

// ---------- co-scholastic: a grade per student per area, saved as you pick ----------

export function CoGrid({ termId, subjects, grades, students, action, editable }: {
  termId: string; subjects: { id: string; name: string }[]; grades: { grade: string; description: string }[];
  students: { id: string; name: string; rollNo: number | null; grades: Record<string, string> }[]; action: Action; editable: boolean;
}) {
  const [cells, setCells] = useState<Record<string, string>>(Object.fromEntries(students.flatMap((s) => Object.entries(s.grades).map(([sub, g]) => [`${s.id}:${sub}`, g]))));
  const [saving, setSaving] = useState<string | null>(null);
  const pick = async (studentId: string, subjectId: string, grade: string) => {
    if (!grade) return;
    const key = `${studentId}:${subjectId}`;
    const before = cells[key];
    setCells((c) => ({ ...c, [key]: grade })); // paint now, write after
    setSaving(key);
    const fd = new FormData();
    fd.set("termId", termId);
    fd.set("entries", JSON.stringify([{ studentId, subjectId, grade }]));
    const r = await action(fd);
    setSaving(null);
    if (!r.ok) { setCells((c) => ({ ...c, [key]: before ?? "" })); toast(r.error, "danger"); }
  };
  if (subjects.length === 0) return <Panel><p className="py-6 text-center text-sm text-[var(--ds-on-surface-muted)]">This class has no co-scholastic subjects. Add them under Academics, Subjects.</p></Panel>;
  return (
    <div className="flex flex-col gap-3">
      {students.map((s) => (
        <Panel key={s.id} title={`${s.rollNo ?? "-"} · ${s.name}`}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {subjects.map((sub) => {
              const key = `${s.id}:${sub.id}`;
              return (
                <label key={sub.id} className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">
                  {sub.name}
                  <select className={INPUT} value={cells[key] ?? ""} disabled={!editable || saving === key} onChange={(e) => pick(s.id, sub.id, e.target.value)} aria-label={`${sub.name} grade for ${s.name}`}>
                    <option value="">Not graded</option>
                    {grades.map((g) => <option key={g.grade} value={g.grade}>{g.grade} · {g.description}</option>)}
                  </select>
                </label>
              );
            })}
          </div>
        </Panel>
      ))}
    </div>
  );
}

// ---------- remarks: one sheet per section ----------

export function RemarksSheet({ sectionId, termId, rows, action }: { sectionId: string; termId: string; rows: { studentId: string; name: string; rollNo: number | null; text: string }[]; action: Action }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState<Record<string, string>>(Object.fromEntries(rows.map((r) => [r.studentId, r.text])));
  const dirty = rows.filter((r) => (text[r.studentId] ?? "") !== r.text);
  const save = () => start(async () => {
    const fd = new FormData();
    fd.set("sectionId", sectionId); fd.set("termId", termId);
    fd.set("entries", JSON.stringify(dirty.map((r) => ({ studentId: r.studentId, text: text[r.studentId] ?? "" }))));
    const r = await action(fd);
    if (r.ok) { toast(`Saved ${dirty.length} remarks`); router.refresh(); } else toast(r.error, "danger");
  });
  if (rows.length === 0) return <Panel><p className="py-6 text-center text-sm text-[var(--ds-on-surface-muted)]">No students in this section yet.</p></Panel>;
  return (
    <div className="flex flex-col gap-3">
      <Panel>
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={r.studentId} className="flex flex-col gap-1">
              <label htmlFor={`rm-${r.studentId}`} className="text-sm text-[var(--ds-on-surface)]">{r.rollNo ?? "-"} · {r.name}</label>
              <textarea id={`rm-${r.studentId}`} rows={2} maxLength={300} value={text[r.studentId] ?? ""} onChange={(e) => setText({ ...text, [r.studentId]: e.target.value })} className={`${INPUT} h-auto py-2`} placeholder="Printed on the report card" />
            </li>
          ))}
        </ul>
      </Panel>
      <div className="sticky bottom-4 flex items-center justify-between gap-3 rounded-3xl bg-[var(--ds-surface-container)] p-4">
        <p className="text-sm text-[var(--ds-on-surface-variant)]" aria-live="polite">{dirty.length ? `${dirty.length} unsaved` : "All saved"}</p>
        <Button type="button" className="rounded-full" isLoading={pending} disabled={!dirty.length} onClick={save}>Save remarks</Button>
      </div>
    </div>
  );
}

// ---------- date sheet ----------

type Paper = { id: string; subject: string; date: string; startTime: string | null; endTime: string | null };

export function DateSheetForm({ examId, groups, clashes, action, editable }: { examId: string; groups: { classId: string; className: string; papers: Paper[] }[]; clashes: Record<string, string>; action: Action; editable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>(clashes);
  const all = groups.flatMap((g) => g.papers);
  const [v, setV] = useState<Record<string, { date: string; startTime: string; endTime: string }>>(Object.fromEntries(all.map((p) => [p.id, { date: p.date, startTime: p.startTime ?? "", endTime: p.endTime ?? "" }])));
  const set = (id: string, patch: Partial<(typeof v)[string]>) => setV((x) => ({ ...x, [id]: { ...x[id]!, ...patch } }));
  const save = () => start(async () => {
    const fd = new FormData();
    fd.set("examId", examId);
    fd.set("papers", JSON.stringify(all.map((p) => ({ paperId: p.id, ...v[p.id]! }))));
    const r = await action(fd);
    if (r.ok) { setErrors({}); toast("Date sheet saved"); router.refresh(); } else { setErrors(r.fieldErrors ?? {}); toast(r.error, "danger"); }
  });
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g) => (
        <Panel key={g.classId} title={g.className}>
          <ul className="flex flex-col gap-2">
            {g.papers.map((p) => (
              <li key={p.id} className="rounded-2xl bg-white/[0.03] p-3">
                <p className="text-sm text-[var(--ds-on-surface)]">{p.subject}</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Date<input type="date" className={INPUT} value={v[p.id]!.date} disabled={!editable} onChange={(e) => set(p.id, { date: e.target.value })} /></label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Starts<input type="time" className={INPUT} value={v[p.id]!.startTime} disabled={!editable} onChange={(e) => set(p.id, { startTime: e.target.value })} /></label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Ends<input type="time" className={INPUT} value={v[p.id]!.endTime} disabled={!editable} onChange={(e) => set(p.id, { endTime: e.target.value })} /></label>
                </div>
                {errors[p.id] ? <p role="alert" className="mt-2 text-xs text-[var(--ds-color-danger-400)]">{errors[p.id]}</p> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ))}
      {editable ? <div className="sticky bottom-4 flex justify-end rounded-3xl bg-[var(--ds-surface-container)] p-4"><Button type="button" className="rounded-full" isLoading={pending} onClick={save}>Save date sheet</Button></div> : null}
    </div>
  );
}

// ---------- pickers that live in the URL ----------

/** Selects whose choice goes into the query string, so the server page loads the data. */
export function QueryPicker({ path, picks }: { path: string; picks: { name: string; label: string; value?: string; options: { value: string; label: string }[] }[] }) {
  const router = useRouter();
  const go = (name: string, value: string) => {
    const next = new URLSearchParams();
    for (const p of picks) { const v = p.name === name ? value : p.value; if (v) next.set(p.name, v); }
    router.replace(`${path}${next.size ? `?${next}` : ""}`);
  };
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
      {picks.map((p) => (
        <label key={p.name} className="flex flex-col gap-1.5 text-xs text-[var(--ds-on-surface-muted)]">
          {p.label}
          <select className={INPUT} value={p.value ?? ""} onChange={(e) => go(p.name, e.target.value)} aria-label={p.label}>
            <option value="">Choose</option>
            {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}
