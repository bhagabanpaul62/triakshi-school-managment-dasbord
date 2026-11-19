"use client";

import { useId, useState, useTransition } from "react";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { Modal, ModalField, ModalFooter } from "@smw/ui/kit/Modal";
import { MenuIconView } from "@smw/ui/shell/icons";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";
import { cellKey, dayName, timeRange } from "../bell";
import type { GridCell, PeriodView, SlotOptions } from "../service";

export interface EditorProps {
  sectionId: string;
  options: SlotOptions;
  setSlot: (fd: FormData) => Promise<FormResult>;
  clearSlot: (fd: FormData) => Promise<FormResult>;
}

/** The small dialog behind one cell: pick a subject, then one of the teachers who teach it. Clashes come back as a message and a toast. */
export function CellEditor({ editor, day, period, cell, onDone, onClose }: {
  editor: EditorProps;
  day: number;
  period: PeriodView;
  cell: GridCell | undefined;
  /** Called with the saved cell, or null after clearing. */
  onDone: (saved: GridCell | null) => void;
  onClose: () => void;
}) {
  const { options } = editor;
  const formId = useId();
  const [subjectId, setSubjectId] = useState(cell?.subjectId ?? "");
  const [teacherId, setTeacherId] = useState(cell?.teacherId ?? "");
  const [room, setRoom] = useState(cell?.room ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const teachers = options.teachers[subjectId] ?? [];
  /** Teachers already in another section at this very period: shown, but not pickable. */
  const busy = options.busy[cellKey(day, period.id)] ?? {};
  const free = (id: string) => !busy[id];

  const pickSubject = (id: string) => {
    setSubjectId(id);
    const list = options.teachers[id] ?? [];
    setTeacherId(list.find((t) => free(t.id))?.id ?? ""); // the section's own teacher comes first when free
    setErrors({});
  };

  const fail = (r: Extract<FormResult, { ok: false }>) => { setErrors({ ...r.fieldErrors, ...(r.fieldErrors ? {} : { form: r.error }) }); toast(r.error, "danger"); };
  const base = () => { const fd = new FormData(); fd.set("sectionId", editor.sectionId); fd.set("dayOfWeek", String(day)); fd.set("periodId", period.id); return fd; };

  const save = () => start(async () => {
    const fd = base();
    fd.set("subjectId", subjectId); fd.set("teacherId", teacherId); fd.set("room", room);
    const r = await editor.setSlot(fd);
    if (!r.ok) return fail(r);
    toast(r.message ?? "Saved");
    onDone(r.data as GridCell);
  });

  const clear = () => start(async () => {
    const r = await editor.clearSlot(base());
    if (!r.ok) return fail(r);
    toast(r.message ?? "Cleared");
    onDone(null);
  });

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} size="md" title={`${dayName(day)}, ${period.name}`}
      description={timeRange(period.startsAt, period.endsAt)} icon={<MenuIconView name="clock" />} dismissOnOutsideClick={false}
      footer={<ModalFooter
        summary={cell ? `Now: ${cell.subject}` : "Nothing planned yet"}
        extra={cell ? <Button type="button" variant="ghost" className="rounded-xl text-[var(--ds-color-danger-400)]" onClick={clear} disabled={pending}>Clear period</Button> : undefined}
        secondary={{ onClick: onClose }} primary={{ label: "Save", type: "submit", form: formId, loading: pending, disabled: !subjectId || !teacherId || !free(teacherId) }} />}>
      <form id={formId} className="flex flex-col gap-4 pt-2" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
        <ModalField label="Subject" htmlFor={`${formId}-subject`} required error={errors.subjectId}>
          <select id={`${formId}-subject`} value={subjectId} onChange={(e) => pickSubject(e.target.value)} className={INPUT} autoFocus>
            <option value="">Choose a subject</option>
            {options.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </ModalField>
        <ModalField label="Teacher" htmlFor={`${formId}-teacher`} required error={errors.teacherId}
          hint={!subjectId ? "Pick a subject first" : teachers.length && !teachers.some((t) => free(t.id)) ? "Everyone who teaches this is busy in this period. Pick another subject." : "Teachers who teach this subject"}>
          <select id={`${formId}-teacher`} value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className={INPUT} disabled={!subjectId}>
            <option value="">Choose a teacher</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id} disabled={!free(t.id) && t.id !== cell?.teacherId}>
                {t.name}{t.id === options.defaults[subjectId] ? " (this section's teacher)" : ""}{free(t.id) ? "" : ` - teaching ${busy[t.id]} now`}
              </option>
            ))}
          </select>
        </ModalField>
        <ModalField label="Room" htmlFor={`${formId}-room`} hint="Optional" error={errors.room}>
          <input id={`${formId}-room`} value={room} onChange={(e) => setRoom(e.target.value)} maxLength={40} className={INPUT} placeholder="Room 5A" />
        </ModalField>
        {errors.form || errors.periodId ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{errors.form ?? errors.periodId}</p> : null}
      </form>
    </Modal>
  );
}
