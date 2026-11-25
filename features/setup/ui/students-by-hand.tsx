"use client";

import { useState } from "react";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { Button } from "@smw/ui/ui/button";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { addStudents } from "./actions";

interface Row { id: number; name: string; sectionId: string; guardianName: string; guardianPhone: string; error?: string }
let seq = 0;
const blank = (): Row => ({ id: ++seq, name: "", sectionId: "", guardianName: "", guardianPhone: "" });

/** Five rows to type in: name, class and section, and a guardian. A bad row stays with its reason; the good ones are saved. */
export function StudentsByHand({ sections }: { sections: { id: string; label: string }[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 5 }, blank));
  const [pending, start] = useTransition();
  const filled = rows.filter((r) => r.name.trim() || r.guardianName.trim() || r.guardianPhone.trim());
  const edit = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch, error: undefined } : r)));
  const save = () => start(async () => {
    const r = await addStudents({ rows: rows.map(({ name, sectionId, guardianName, guardianPhone }) => ({ name, sectionId, guardianName, guardianPhone })) });
    if (!r.ok) { toast(r.error, "danger"); return; }
    const bad = new Map(r.data.failed.map((f) => [f.line, f.error]));
    toast(`${r.data.added} added${bad.size ? `. ${bad.size} need a fix.` : ""}`, bad.size ? "danger" : undefined);
    setRows((rs) => rs.map((row, i) => ({ ...row, error: bad.get(i + 1) })).filter((row) => row.error));
    if (!bad.size) { setRows(Array.from({ length: 5 }, blank)); router.refresh(); }
  });
  return (
    <div className="mt-6 border-t border-white/[0.06] pt-5">
      <p className="text-sm font-medium text-[var(--ds-on-surface)]">Or add a few by hand</p>
      <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">Name and class are enough. Add the guardian's name and phone together, or leave both empty.</p>
      <ul className="mt-3 flex flex-col gap-3">
        {rows.map((r, i) => (
          <li key={r.id}>
            <div className="grid gap-2 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Student {i + 1} name
                <input placeholder="Full name" value={r.name} onChange={(e) => edit(r.id, { name: e.target.value })} className={INPUT} autoComplete="off" /></label>
              <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Class and section
                <select value={r.sectionId} onChange={(e) => edit(r.id, { sectionId: e.target.value })} className={INPUT}>
                  <option value="">Choose</option>
                  {sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select></label>
              <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Guardian name
                <input placeholder="Guardian" value={r.guardianName} onChange={(e) => edit(r.id, { guardianName: e.target.value })} className={INPUT} autoComplete="off" /></label>
              <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Guardian phone
                <input type="tel" inputMode="tel" placeholder="10 digits" value={r.guardianPhone} onChange={(e) => edit(r.id, { guardianPhone: e.target.value })} className={INPUT} autoComplete="off" /></label>
            </div>
            {r.error ? <p role="alert" className="mt-1 text-xs text-[var(--ds-color-danger-300)]">{r.error}</p> : null}
          </li>
        ))}
      </ul>
      <Button type="button" variant="secondary" className="mt-4 rounded-full" disabled={pending || !filled.length} isLoading={pending} onClick={save}>
        {filled.length ? `Add ${filled.length} ${filled.length === 1 ? "student" : "students"}` : "Add students"}
      </Button>
    </div>
  );
}
