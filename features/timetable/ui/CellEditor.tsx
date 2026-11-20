"use client";

import { useId, useState, useTransition } from "react";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { Modal, ModalField, ModalFooter } from "@smw/ui/kit/Modal";
import { MenuIconView } from "@smw/ui/shell/icons";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";
import { cellKey, dayName, timeRange } from "../bell";
import { limitWarning } from "../limits";
import type { GridCell, PeriodView, SlotOptions } from "../service";

export interface EditorProps {
  sectionId: string;
  options: SlotOptions;
  setSlot: (fd: FormData) => Promise<FormResult>;
  clearSlot: (fd: FormData) => Promise<FormResult>;
  /** Put an elective block at the cell for the whole class. */
  setBlock?: (fd: FormData) => Promise<FormResult>;
  /** Editing a draft: every call carries its id. */
  versionId?: string;
  /** Pin or release a cell of a draft. */
  lock?: (fd: FormData) => Promise<FormResult>;
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
  const [kind, setKind] = useState<"class" | "block">(cell?.blockId ? "block" : "class");
  const [blockId, setBlockId] = useState(cell?.blockId ?? "");
  const hasBlocks = !!editor.setBlock && options.blocks.length > 0;
  const placedBlock = !!cell?.blockId;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const teachers = options.teachers[subjectId] ?? [];
  /** Teachers already in another section at this very period: shown, but not pickable. */
  const busy = options.busy[cellKey(day, period.id)] ?? {};
  const free = (id: string) => !busy[id];
  /** Past their max per day or week: still pickable (the admin decides), but said out loud. */
  const over = (id: string) => limitWarning(options.limits ?? {}, id, day, id === cell?.teacherId);
  const overNow = teacherId ? over(teacherId) : null;

  const pickSubject = (id: string) => {
    setSubjectId(id);
    const list = options.teachers[id] ?? [];
    setTeacherId(list.find((t) => free(t.id))?.id ?? ""); // the section's own teacher comes first when free
    setErrors({});
  };

  const fail = (r: Extract<FormResult, { ok: false }>) => { setErrors({ ...r.fieldErrors, ...(r.fieldErrors ? {} : { form: r.error }) }); toast(r.error, "danger"); };
  const base = () => { const fd = new FormData(); fd.set("sectionId", editor.sectionId); fd.set("dayOfWeek", String(day)); fd.set("periodId", period.id); if (editor.versionId) fd.set("versionId", editor.versionId); return fd; };

  const saveBlock = () => start(async () => {
    const fd = base();
    fd.set("blockId", blockId);
    const r = await editor.setBlock!(fd);
    if (!r.ok) return fail(r);
    toast(r.message ?? "Saved");
    onDone(r.data as GridCell);
  });

  const save = () => kind === "block" ? saveBlock() : start(async () => {
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

  const togglePin = () => start(async () => {
    if (!cell || !editor.lock || !editor.versionId) return;
    const fd = base();
    fd.set("locked", cell.locked ? "" : "true");
    const r = await editor.lock(fd);
    if (!r.ok) return fail(r);
    toast(cell.locked ? "Released" : "Pinned: a re-run keeps this period");
    onDone({ ...cell, locked: !cell.locked });
  });

  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} size="md" title={`${dayName(day)}, ${period.name}`}
      description={timeRange(period.startsAt, period.endsAt)} icon={<MenuIconView name="clock" />} dismissOnOutsideClick={false}
      footer={<ModalFooter
        summary={cell ? `Now: ${cell.subject}` : "Nothing planned yet"}
        extra={cell ? <>
          <Button type="button" variant="ghost" className="rounded-xl text-[var(--ds-color-danger-400)]" onClick={clear} disabled={pending}>{placedBlock ? "Remove block (whole class)" : "Clear period"}</Button>
          {editor.lock ? <Button type="button" variant="ghost" className="rounded-xl" onClick={togglePin} disabled={pending}>{cell.locked ? "Unpin" : "Pin period"}</Button> : null}
        </> : undefined}
        secondary={{ onClick: onClose }} primary={{ label: "Save", type: "submit", form: formId, loading: pending, disabled: kind === "block" ? !blockId || placedBlock : !subjectId || !teacherId || !free(teacherId) || placedBlock }} />}>
      <form id={formId} className="flex flex-col gap-4 pt-2" noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
        {hasBlocks && !placedBlock ? (
          <ModalField label="This period is" htmlFor={`${formId}-kind`}>
            <select id={`${formId}-kind`} value={kind} onChange={(e) => setKind(e.target.value as "class" | "block")} className={INPUT}>
              <option value="class">One class for this section</option>
              <option value="block">An elective block (the whole class)</option>
            </select>
          </ModalField>
        ) : null}
        {placedBlock ? (
          <p className="text-sm text-[var(--ds-on-surface-variant)]">{cell!.subject}. This block holds every section of the class at this time. Remove it to plan something else here.</p>
        ) : kind === "block" ? (
          <ModalField label="Elective block" htmlFor={`${formId}-block`} required error={errors.blockId} hint="Every section of the class sits in it; students split by the subject they chose">
            <select id={`${formId}-block`} value={blockId} onChange={(e) => setBlockId(e.target.value)} className={INPUT} autoFocus>
              <option value="">Choose a block</option>
              {options.blocks.map((b) => <option key={b.id} value={b.id}>{b.name}: {b.options}</option>)}
            </select>
          </ModalField>
        ) : <>
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
                {t.name}{t.id === options.defaults[subjectId] ? " (this section's teacher)" : ""}{free(t.id) ? (over(t.id) ? " - over their limit" : "") : ` - teaching ${busy[t.id]} now`}
              </option>
            ))}
          </select>
          {overNow ? <p role="status" className="mt-1.5 text-xs text-[var(--ds-color-warning-400)]">Heads up: {overNow}. You can still save.</p> : null}
        </ModalField>
        <ModalField label="Room" htmlFor={`${formId}-room`} hint="Optional" error={errors.room}>
          <input id={`${formId}-room`} value={room} onChange={(e) => setRoom(e.target.value)} maxLength={40} className={INPUT} placeholder="Room 5A" />
        </ModalField>
        </>}
        {errors.form || errors.periodId ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{errors.form ?? errors.periodId}</p> : null}
      </form>
    </Modal>
  );
}
