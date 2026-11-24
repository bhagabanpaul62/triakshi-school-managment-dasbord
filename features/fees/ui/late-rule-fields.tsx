"use client";

import { IconTrash } from "@tabler/icons-react";
import { Button } from "@smw/ui/ui/button";
import { INPUT } from "@smw/ui/shell/FormModal";
import { MoneyInput } from "@smw/ui/finance/MoneyInput";
import type { LateRule } from "../constants";
import { lateExample, lateRuleSentence } from "./logic";

const field = "flex flex-col gap-1.5 text-sm";
export interface Late { kind: "" | LateRule["kind"]; amountPaise: number | null; percent: string; grace: string; max: number | null; slabs: { afterDays: string; amountPaise: number | null }[] }

export function lateFrom(r: LateRule | null | undefined): Late {
  if (!r) return { kind: "", amountPaise: null, percent: "", grace: "0", max: null, slabs: [{ afterDays: "10", amountPaise: null }] };
  return { kind: r.kind, amountPaise: r.amountPaise ?? null, percent: r.basisPoints ? String(r.basisPoints / 100) : "", grace: String(r.graceDays), max: r.maxPaise ?? null, slabs: r.slabs?.length ? r.slabs.map((s) => ({ afterDays: String(s.afterDays), amountPaise: s.amountPaise })) : [{ afterDays: "10", amountPaise: null }] };
}
export function lateRuleOf(l: Late): LateRule | null {
  if (!l.kind) return null;
  const base = { kind: l.kind, graceDays: Math.max(0, Math.round(Number(l.grace) || 0)), maxPaise: l.max || null };
  if (l.kind === "percent") return { ...base, basisPoints: Math.round((Number(l.percent) || 0) * 100) };
  if (l.kind === "slabs") return { ...base, slabs: l.slabs.filter((s) => s.amountPaise && Number(s.afterDays) > 0).map((s) => ({ afterDays: Math.round(Number(s.afterDays)), amountPaise: s.amountPaise! })) };
  return { ...base, amountPaise: l.amountPaise ?? 0 };
}

/** The late fee rule as a form: the kind, grace days, the amount, and a cap. The one form for plans and for single bills. */
export function LateRuleFields({ late, onChange: setLate }: { late: Late; onChange: (l: Late) => void }) {
  return (
    <>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className={`${field} sm:col-span-2`}>Rule<select value={late.kind} onChange={(e) => setLate({ ...late, kind: e.target.value as Late["kind"] })} className={INPUT}><option value="">No late fee</option><option value="flat">A fixed amount, once</option><option value="per_day">An amount for every day late</option><option value="percent">A percent of what is unpaid, once</option><option value="slabs">Steps by how many days late</option></select></label>
            {late.kind ? <label className={field}>Grace days<input type="number" min={0} max={365} value={late.grace} onChange={(e) => setLate({ ...late, grace: e.target.value })} className={INPUT} /></label> : null}
            {late.kind === "flat" || late.kind === "per_day" ? <MoneyInput label="Amount" valuePaise={late.amountPaise} onChange={(p) => setLate({ ...late, amountPaise: p })} /> : null}
            {late.kind === "percent" ? <label className={field}>Percent<input inputMode="decimal" value={late.percent} onChange={(e) => setLate({ ...late, percent: e.target.value })} className={INPUT} /></label> : null}
            {late.kind ? <MoneyInput label="Most it can reach (optional)" valuePaise={late.max} onChange={(p) => setLate({ ...late, max: p })} /> : null}
          </div>
          {late.kind === "slabs" ? (
            <div className="flex flex-col gap-2">{late.slabs.map((s, i) => <div key={i} className="grid max-w-md grid-cols-[1fr_1fr_auto] items-end gap-2"><label className={field}>After days late<input type="number" min={1} value={s.afterDays} onChange={(e) => setLate({ ...late, slabs: late.slabs.map((x, j) => (j === i ? { ...x, afterDays: e.target.value } : x)) })} className={INPUT} /></label><MoneyInput label="Fee" valuePaise={s.amountPaise} onChange={(p) => setLate({ ...late, slabs: late.slabs.map((x, j) => (j === i ? { ...x, amountPaise: p } : x)) })} /><button type="button" aria-label="Remove step" onClick={() => setLate({ ...late, slabs: late.slabs.filter((_, j) => j !== i) })} className="h-10 w-10 rounded-full hover:bg-white/[0.08]"><IconTrash className="mx-auto h-4 w-4" aria-hidden /></button></div>)}
              <Button type="button" variant="ghost" className="self-start rounded-full" onClick={() => setLate({ ...late, slabs: [...late.slabs, { afterDays: "", amountPaise: null }] })}>Add a step</Button></div>
          ) : null}
    </>
  );
}

/** The rule in words and one worked example, so nobody has to do the sum to know what the family will pay. */
export function LateRuleSentence({ rule, openPaise }: { rule: LateRule | null; /** The example uses this amount (a bill's total) when given. */ openPaise?: number }) {
  return <p className="text-sm">{lateRuleSentence(rule)} {lateExample(rule, openPaise || undefined).sentence}</p>;
}
