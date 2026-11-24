"use client";

import { useId, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { INPUT } from "@smw/ui/shell/FormModal";
import { LABEL } from "@smw/ui/tone";
import { addDays } from "../stats";

export type PickerField = {
  name: string;
  label: string;
  type: "select" | "date" | "month";
  value: string;
  options?: { value: string; label: string }[];
  max?: string;
};

/** Filters that live in the URL (section, date, month): changing one reloads the server page. */
export function QueryPicker({ fields }: { fields: PickerField[] }) {
  const router = useRouter();
  const path = usePathname();
  const uid = useId();
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.name, f.value])));

  const change = (name: string, value: string) => {
    const next = { ...values, [name]: value };
    setValues(next);
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v));
    router.replace(`${path}?${qs.toString()}`, { scroll: false });
  };

  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      {fields.map((f) => (
        <div key={f.name} className="min-w-[10rem] flex-1 sm:flex-none">
          <label htmlFor={`${uid}${f.name}`} className={`${LABEL} mb-1.5 block`}>{f.label}</label>
          {f.type === "select" ? (
            <select id={`${uid}${f.name}`} className={INPUT} value={values[f.name]} onChange={(e) => change(f.name, e.target.value)}>
              {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : f.type === "date" ? (
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Previous day" title="Previous day" onClick={() => change(f.name, addDays(values[f.name]!, -1))}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-[var(--ds-on-surface-variant)] hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]"><IconChevronLeft className="h-4 w-4" aria-hidden /></button>
              <input id={`${uid}${f.name}`} type="date" className={`${INPUT} min-w-0`} value={values[f.name]} max={f.max} onChange={(e) => e.target.value && change(f.name, e.target.value)} />
              <button type="button" aria-label="Next day" title="Next day" disabled={!!f.max && values[f.name]! >= f.max} onClick={() => change(f.name, addDays(values[f.name]!, 1))}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.05] text-[var(--ds-on-surface-variant)] hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)] disabled:opacity-30"><IconChevronRight className="h-4 w-4" aria-hidden /></button>
              {f.max && values[f.name] !== f.max ? <button type="button" onClick={() => change(f.name, f.max!)} className="h-10 shrink-0 rounded-full px-3 text-sm text-[var(--ds-color-primary-300)] hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Today</button> : null}
            </div>
          ) : (
            <input id={`${uid}${f.name}`} type={f.type} className={INPUT} value={values[f.name]} max={f.max} onChange={(e) => e.target.value && change(f.name, e.target.value)} />
          )}
        </div>
      ))}
    </div>
  );
}
