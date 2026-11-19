"use client";

import { useState, useTransition } from "react";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { TONE } from "@smw/ui/widgets/WidgetPrimitives";

type Option = { value: string; label: string };

/**
 * A teacher picker that saves on change: paints the new value at once, posts `fields` plus the teacher to a server action,
 * and rolls back with a toast if the save fails. Used for class teachers and for each cell of the subject-teacher matrix.
 */
export function TeacherSelect({ label, value, teachers, action, fields, name = "teacherId", empty = "No teacher", onSaved, className = "" }: {
  label: string;
  value: string;
  teachers: Option[];
  action: (fd: FormData) => Promise<FormResult>;
  /** Hidden values sent with the pick (section, subject). */
  fields: Record<string, string>;
  /** The form field that carries the teacher id. */
  name?: string;
  /** Text for "nobody"; shown in the warning colour because an empty slot needs action. */
  empty?: string;
  onSaved?: (teacherId: string) => void;
  className?: string;
}) {
  const [current, setCurrent] = useState(value);
  const [pending, start] = useTransition();

  const change = (next: string) => {
    const previous = current;
    setCurrent(next); onSaved?.(next);
    start(async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      fd.set(name, next);
      const r = await action(fd);
      if (r.ok) return;
      setCurrent(previous); onSaved?.(previous);
      toast(r.error, "danger");
    });
  };

  return (
    <select aria-label={label} value={current} onChange={(e) => change(e.target.value)} aria-busy={pending}
      className={`${INPUT} ${current ? "" : TONE.warning.text} ${className}`}>
      <option value="">{empty}</option>
      {teachers.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
    </select>
  );
}
