"use client";

import { useState } from "react";
import type { FormResult } from "@smw/ui/shell/FormModal";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { TeacherSelect } from "./teacher-select";

type Option = { value: string; label: string };
const HEAD = "font-mono text-[11px] font-normal uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]";

/** Subjects down the side, sections across the top; each cell is the teacher. Saves one cell at a time; a column header counts what is still unset. */
export function TeacherMatrix({ sections, subjects, teachers, cells, editable, action }: {
  sections: { id: string; name: string }[];
  subjects: { subjectId: string; name: string }[];
  teachers: Option[];
  cells: Record<string, string>;
  editable: boolean;
  action: (fd: FormData) => Promise<FormResult>;
}) {
  const [value, setValue] = useState(cells);
  const nameOf = (id?: string) => teachers.find((t) => t.value === id)?.label;
  const missing = (sectionId: string) => subjects.filter((s) => !value[`${sectionId}:${s.subjectId}`]).length;

  return (
    <div className="custom-scrollbar -mx-2 overflow-x-auto px-2">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr>
            <th scope="col" className={`pb-3 pr-4 text-left ${HEAD}`}>Subject</th>
            {sections.map((s) => (
              <th key={s.id} scope="col" className={`px-2 pb-3 text-left ${HEAD}`}>
                <span className="block">Section {s.name}</span>
                {missing(s.id) ? <span className="mt-1 block normal-case tracking-normal"><ToneBadge tone="warning" label={`${missing(s.id)} to set`} /></span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {subjects.map((sub) => (
            <tr key={sub.subjectId} className="hover:bg-white/[0.03]">
              <th scope="row" className="py-2 pr-4 text-left font-normal text-[var(--ds-on-surface)]">{sub.name}</th>
              {sections.map((sec) => {
                const key = `${sec.id}:${sub.subjectId}`;
                const current = value[key] ?? "";
                return (
                  <td key={sec.id} className="px-2 py-2">
                    {editable ? (
                      <TeacherSelect label={`${sub.name} teacher for section ${sec.name}`} value={current} teachers={teachers} action={action}
                        fields={{ sectionId: sec.id, subjectId: sub.subjectId }} empty="Pick a teacher"
                        onSaved={(t) => setValue((v) => ({ ...v, [key]: t }))} />
                    ) : (
                      <span className={current ? "" : "text-[var(--ds-on-surface-muted)]"}>{nameOf(current) ?? "-"}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
