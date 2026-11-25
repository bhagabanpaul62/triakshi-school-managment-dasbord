"use client";

import { useState } from "react";
import { toast } from "@smw/ui/shell/toast";
import Link from "next/link";
import { INPUT } from "@smw/ui/shell/FormModal";
import { saveClassTeachers } from "./actions";
import { StepFooter, useStepRun } from "./wizard";

/** One select per section. Only the sections you change are saved; a blank clears the class teacher. */
export function ClassTeachers({ sections, teachers, next, back, skip }: {
  sections: { id: string; label: string; teacherId: string | null }[]; teachers: { id: string; name: string; invited: boolean }[]; next: string; back: string | null; skip: string;
}) {
  const [picks, setPicks] = useState<Record<string, string>>(() => Object.fromEntries(sections.map((s) => [s.id, s.teacherId ?? ""])));
  const { pending, run } = useStepRun(next);
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!sections.length) return <p className="text-sm text-[var(--ds-on-surface-variant)]">You have no sections yet. <Link href="/app/setup/classes" className="underline">Add your classes</Link> first.</p>;
  if (!teachers.length) {
    return (
      <>
        <p className="text-sm text-[var(--ds-on-surface-variant)]">You have no teachers yet. <Link href="/app/setup/staff" className="underline">Add your teachers</Link> first, then come back here.</p>
        <StepFooter back={back} skip={skip} label="Continue" onClick={() => undefined} disabled />
      </>
    );
  }
  const taken = new Map<string, string[]>();
  for (const [sid, tid] of Object.entries(picks)) if (tid) taken.set(tid, [...(taken.get(tid) ?? []), sid]);
  return (
    <div>
      <ul className="flex flex-col gap-2">
        {sections.map((s) => (
          <li key={s.id} className="grid grid-cols-[6rem_1fr] items-center gap-3">
            <label htmlFor={`ct-${s.id}`} className="text-sm text-[var(--ds-on-surface)]">{s.label}</label>
            <select id={`ct-${s.id}`} value={picks[s.id] ?? ""} aria-invalid={!!errors[s.id]} onChange={(e) => { setPicks((p) => ({ ...p, [s.id]: e.target.value })); setErrors(({ [s.id]: _, ...rest }) => rest); }} className={INPUT}>
              <option value="">No class teacher yet</option>
              {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}{t.invited ? " (invited)" : ""}{taken.get(t.id)?.some((x) => x !== s.id) ? " (already has a section)" : ""}</option>)}
            </select>
            {errors[s.id] ? <p role="alert" className="col-start-2 text-xs text-[var(--ds-color-danger-300)]">{errors[s.id]}</p> : null}
          </li>
        ))}
      </ul>
      <StepFooter back={back} skip={skip} label="Save and continue" pending={pending}
        onClick={() => run(() => saveClassTeachers({ picks: sections.map((s) => ({ sectionId: s.id, teacherId: picks[s.id] ?? "" })) }), (data) => {
          // The rows that went through are saved; each bad one keeps its reason and we stay here.
          const failed = (data as { failed: { sectionId: string; error: string }[] }).failed;
          if (!failed.length) return;
          setErrors(Object.fromEntries(failed.map((f) => [f.sectionId, f.error])));
          toast(`${failed.length} could not be saved. See the reasons below.`, "danger");
          return false;
        })} />
    </div>
  );
}
