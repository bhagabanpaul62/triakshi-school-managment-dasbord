"use client";

import { useState } from "react";
import { Money } from "@smw/ui/finance/Money";
import { dayLabel, planTotals, type PlanDue } from "./logic";
import { MUTED } from "./styles";

/** What one student would be billed under this plan, bill by bill, with the optional fees they choose to take. */
export function PlanPreview({ lines }: { lines: { headId: string; headName: string; optional: boolean; dues: PlanDue[] }[] }) {
  const optional = lines.filter((l) => l.optional);
  const [taken, setTaken] = useState<string[]>([]);
  const t = planTotals(lines.filter((l) => !l.optional || taken.includes(l.headId)));
  return (
    <div className="flex flex-col gap-3">
      {optional.length ? <div className="flex flex-wrap gap-2" role="group" aria-label="Optional fees this student takes">{optional.map((l) => <label key={l.headId} className="flex cursor-pointer items-center gap-2 rounded-full bg-white/[0.05] px-3 py-1.5 text-sm has-[:checked]:bg-white/[0.14]"><input type="checkbox" checked={taken.includes(l.headId)} onChange={() => setTaken((x) => (x.includes(l.headId) ? x.filter((i) => i !== l.headId) : [...x, l.headId]))} className="accent-[var(--ds-primary)]" />Takes {l.headName}</label>)}</div> : null}
      <div className="custom-scrollbar overflow-x-auto"><table className="w-full min-w-[360px] text-sm"><tbody>
        {t.byDue.map((d) => <tr key={d.dueKey} className="border-t border-white/[0.06]"><td className="py-1.5">{d.label}</td><td className={`${MUTED} py-1.5`}>due {dayLabel(d.dueOn)}</td><td className="py-1.5 text-right"><Money paise={d.requiredPaise + d.optionalPaise} /></td></tr>)}
        <tr className="border-t border-white/[0.12] font-medium"><td className="py-2" colSpan={2}>In the year</td><td className="py-2 text-right"><Money paise={t.yearPaise + t.optionalPaise} size="lg" /></td></tr>
      </tbody></table></div>
    </div>
  );
}
