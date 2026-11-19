"use client";

import { useState } from "react";
import { IconPlus, IconX } from "@tabler/icons-react";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import type { TeacherResult } from "../service";
import { inviteTeachers } from "./actions";
import { StepFooter, useStepRun } from "./wizard";

interface Row { id: number; name: string; email: string; error?: string }
let seq = 0;
const blankRow = (): Row => ({ id: ++seq, name: "", email: "" });
const MAX = 30;

/** Name and email rows. Each good row becomes an invited teacher; a bad row stays on screen with its reason. */
export function StaffInvites({ existing, next, back, skip }: { existing: number; next: string; back: string | null; skip: string }) {
  const [rows, setRows] = useState<Row[]>(() => [blankRow(), blankRow(), blankRow()]);
  const { pending, run } = useStepRun(next);
  const filled = rows.filter((r) => r.name.trim() || r.email.trim());
  const edit = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, error: undefined } : r)));

  const send = () => run(() => inviteTeachers({ rows: rows.map(({ name, email }) => ({ name, email })) }), (data) => {
    const r = data as TeacherResult;
    if (!r.failed.length) return;
    // Keep the rows that failed (with the reason); the ones that went through are gone from the list.
    const bad = new Map(r.failed.map((f) => [f.line, f.error]));
    setRows((rs) => rs.map((row, i) => ({ ...row, error: bad.get(i + 1) })).filter((row) => row.error));
    toast(`${r.added.length} invited. ${r.failed.length} need a fix.`, "danger");
    return false;
  });

  return (
    <div>
      {existing > 0 ? <p className="mb-5 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-[var(--ds-on-surface-variant)]">You already have {existing} {existing === 1 ? "teacher" : "teachers"}. New ones are added to them.</p> : null}
      <ul className="flex flex-col gap-3">
        {rows.map((r, i) => (
          <li key={r.id}>
            <div className="grid grid-cols-[1fr_auto] items-start gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <input aria-label={`Teacher ${i + 1} name`} placeholder="Full name" value={r.name} onChange={(e) => edit(r.id, { name: e.target.value })} className={INPUT} autoComplete="off" />
              <input aria-label={`Teacher ${i + 1} email`} type="email" placeholder="name@school.in" value={r.email} onChange={(e) => edit(r.id, { email: e.target.value })} aria-invalid={!!r.error} className={`${INPUT} col-span-2 col-start-1 row-start-2 sm:col-span-1 sm:col-start-auto sm:row-start-auto`} autoComplete="off" />
              <button type="button" aria-label={`Remove teacher ${i + 1}`} title="Remove" onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.id !== r.id) : [blankRow()]))}
                className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--ds-on-surface-muted)] hover:bg-white/[0.06] hover:text-[var(--ds-on-surface)]"><IconX className="h-4 w-4" aria-hidden /></button>
            </div>
            {r.error ? <p role="alert" className="mt-1 text-xs text-[var(--ds-color-danger-300)]">{r.error}</p> : null}
          </li>
        ))}
      </ul>
      <button type="button" disabled={rows.length >= MAX} onClick={() => setRows((rs) => [...rs, blankRow()])}
        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-sm text-[var(--ds-on-surface-variant)] hover:bg-white/[0.1] disabled:opacity-50"><IconPlus className="h-4 w-4" aria-hidden />Add another</button>
      <p className="mt-4 text-xs text-[var(--ds-on-surface-muted)]">Each teacher gets an email with a link to set their own password. Class teachers and timetables come later.</p>
      <StepFooter back={back} skip={skip} label={filled.length ? `Invite ${filled.length} ${filled.length === 1 ? "teacher" : "teachers"}` : "Invite teachers"} pending={pending} disabled={!filled.length}
        summary={filled.length ? undefined : "Or skip, and add staff from the Staff page"} onClick={send} />
    </div>
  );
}
