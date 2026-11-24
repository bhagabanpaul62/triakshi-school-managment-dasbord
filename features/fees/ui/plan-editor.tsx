"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { Button } from "@smw/ui/ui/button";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { Money } from "@smw/ui/finance/Money";
import { MoneyInput } from "@smw/ui/finance/MoneyInput";
import { VarianceBar } from "@smw/ui/finance/VarianceBar";
import type { LateRule } from "../constants";
import { deletePlanDraft, savePlan, submitPlan } from "./actions";
import { DEFAULT_SCHEDULE, SCHEDULES, dayLabel, generateDues, lateExample, lateRuleSentence, planProblems, planTotals, type PlanDue, type Schedule, type ScheduleOptions, type YearSpan } from "./logic";
import { useUnsavedGuard } from "./use-unsaved-guard";
import { CARD, H3, LINK, MUTED } from "./styles";

export interface PlanEditorProps {
  year: YearSpan & { id: string; name: string };
  heads: { id: string; name: string }[];
  classes: { id: string; name: string }[];
  /** What each class's published plan came to last year, for the hike view. */
  lastYear: { classId: string; name: string; fromPaise: number }[];
  plan?: { id: string; rootId: string; version: number; name: string; admissionType: string; joinRule: string; lateRule: LateRule | null; note: string | null; classIds: string[]; lines: { headId: string; optional: boolean; dues: PlanDue[] }[] };
}

interface L { key: string; headId: string; optional: boolean; schedule: Schedule; amountPaise: number | null; opts: ScheduleOptions; dues: PlanDue[] }
interface Late { kind: "" | LateRule["kind"]; amountPaise: number | null; percent: string; grace: string; max: number | null; slabs: { afterDays: string; amountPaise: number | null }[] }
const key = () => Math.random().toString(36).slice(2);
const field = "flex flex-col gap-1.5 text-sm";

function lateFrom(r: LateRule | null | undefined): Late {
  if (!r) return { kind: "", amountPaise: null, percent: "", grace: "0", max: null, slabs: [{ afterDays: "10", amountPaise: null }] };
  return { kind: r.kind, amountPaise: r.amountPaise ?? null, percent: r.basisPoints ? String(r.basisPoints / 100) : "", grace: String(r.graceDays), max: r.maxPaise ?? null, slabs: r.slabs?.length ? r.slabs.map((s) => ({ afterDays: String(s.afterDays), amountPaise: s.amountPaise })) : [{ afterDays: "10", amountPaise: null }] };
}
function lateRule(l: Late): LateRule | null {
  if (!l.kind) return null;
  const base = { kind: l.kind, graceDays: Math.max(0, Math.round(Number(l.grace) || 0)), maxPaise: l.max || null };
  if (l.kind === "percent") return { ...base, basisPoints: Math.round((Number(l.percent) || 0) * 100) };
  if (l.kind === "slabs") return { ...base, slabs: l.slabs.filter((s) => s.amountPaise && Number(s.afterDays) > 0).map((s) => ({ afterDays: Math.round(Number(s.afterDays)), amountPaise: s.amountPaise! })) };
  return { ...base, amountPaise: l.amountPaise ?? 0 };
}

/** The plan builder: classes, the fees as rows with a schedule, dates made from the academic year, the late fee in words, and the totals as you go. */
export function PlanEditor({ year, heads, classes, lastYear, plan }: PlanEditorProps) {
  const router = useRouter();
  const [name, setName] = useState(plan?.name ?? "");
  const [admissionType, setAdmissionType] = useState(plan?.admissionType ?? "all");
  const [joinRule, setJoinRule] = useState(plan?.joinRule ?? "due_after_joining");
  const [classIds, setClassIds] = useState<string[]>(plan?.classIds ?? []);
  const [note, setNote] = useState(plan?.note ?? "");
  const [late, setLate] = useState<Late>(lateFrom(plan?.lateRule));
  const [lines, setLines] = useState<L[]>(() => plan?.lines.map((l) => ({ key: key(), headId: l.headId, optional: l.optional, schedule: "custom", amountPaise: l.dues[0]?.amountPaise ?? null, opts: { ...DEFAULT_SCHEDULE, dates: l.dues.map((d) => d.dueOn) }, dues: l.dues })) ?? []);
  const [planId, setPlanId] = useState(plan?.id);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const savedSig = useRef("");

  const headName = (id: string) => heads.find((h) => h.id === id)?.name ?? "A fee";
  const body = useMemo(() => ({ id: planId, yearId: year.id, rootId: plan?.rootId, name, admissionType, joinRule, lateRule: lateRule(late), note: note || undefined, classIds, lines: lines.map((l) => ({ headId: l.headId, optional: l.optional, dues: l.dues })) }), [planId, year.id, plan?.rootId, name, admissionType, joinRule, late, note, classIds, lines]);
  const sig = JSON.stringify(body);
  if (!savedSig.current) savedSig.current = sig;
  const dirty = sig !== savedSig.current;
  useUnsavedGuard(dirty);
  const totals = planTotals(lines);
  const problems = planProblems({ name, classIds, lines: lines.map((l) => ({ headId: l.headId, headName: headName(l.headId), optional: l.optional, dues: l.dues })) });
  const rule = lateRule(late), example = lateExample(rule);
  const picked = lastYear.filter((c) => classIds.includes(c.classId) && c.fromPaise > 0);

  const setLine = (k: string, patch: Partial<L>, regen = false) => setLines((ls) => ls.map((l) => {
    if (l.key !== k) return l;
    const n = { ...l, ...patch };
    if (!regen) return n;
    // Own dates keep the keys they have, so a bill already issued for a due is never issued again under a new key.
    if (n.schedule === "custom") return patch.amountPaise && n.amountPaise ? { ...n, dues: n.dues.map((d) => ({ ...d, amountPaise: n.amountPaise! })) } : n;
    return n.amountPaise ? { ...n, dues: generateDues(n.schedule, year, n.amountPaise, n.opts) } : n;
  }));
  const addDate = (l: L, date: string) => {
    if (l.dues.some((d) => d.dueOn === date)) return;
    const [d] = generateDues("custom", year, l.amountPaise ?? l.dues[0]?.amountPaise ?? 0, { ...l.opts, dates: [date] });
    if (d && d.amountPaise > 0) setLine(l.key, { dues: [...l.dues, d].sort((a, b) => a.dueOn.localeCompare(b.dueOn)) });
    else setError("Enter the amount first, then add dates.");
  };
  const setOpts = (l: L, o: Partial<ScheduleOptions>) => setLine(l.key, { opts: { ...l.opts, ...o } }, true);
  const setDue = (l: L, i: number, p: Partial<PlanDue>) => setLine(l.key, { dues: l.dues.map((d, j) => (j === i ? { ...d, ...p } : d)) });
  const addLine = () => { const free = heads.find((h) => !lines.some((l) => l.headId === h.id)); if (free) setLines((ls) => [...ls, { key: key(), headId: free.id, optional: false, schedule: "monthly", amountPaise: null, opts: DEFAULT_SCHEDULE, dues: [] }]); };

  const save = (then: "stay" | "submit") => start(async () => {
    setError("");
    if (problems.length) { setError(problems[0]!); return; }
    const r = await savePlan(JSON.stringify(body));
    if (!r.ok) { setError(r.error); return; }
    savedSig.current = sig; setPlanId(r.data.id);
    if (then === "submit") {
      const fd = new FormData(); fd.set("id", r.data.id);
      const s = await submitPlan(fd);
      if (!s.ok) { toast(`Saved as a draft. ${s.error}`, "danger"); router.push(`/app/fees/plans/${r.data.id}`); return; }
      toast("Sent for approval");
    } else toast("Draft saved");
    router.push(`/app/fees/plans/${r.data.id}`);
  });
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); saveRef.current("stay"); } };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  const discard = () => start(async () => {
    if (planId && !plan) { const fd = new FormData(); fd.set("id", planId); await deletePlanDraft(fd); }
    savedSig.current = sig; router.push("/app/fees/plans");
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="flex min-w-0 flex-col gap-5">
        <section className={`${CARD} flex flex-col gap-4`} aria-label="Plan details">
          <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            <label className={field}>Plan name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Classes 1 to 5, new admissions" className={INPUT} /></label>
            <label className={field}>For<select value={admissionType} onChange={(e) => setAdmissionType(e.target.value)} className={INPUT}><option value="all">All students</option><option value="new">New admissions</option><option value="existing">Existing students</option></select></label>
          </div>
          <fieldset><legend className={H3}>Classes <span className={MUTED}>year {year.name}</span></legend>
            <div className="flex flex-wrap gap-2">{classes.map((c) => <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-full bg-white/[0.05] px-3 py-1.5 text-sm has-[:checked]:bg-white/[0.14]"><input type="checkbox" checked={classIds.includes(c.id)} onChange={() => setClassIds((x) => (x.includes(c.id) ? x.filter((i) => i !== c.id) : [...x, c.id]))} className="accent-[var(--ds-primary)]" />{c.name}</label>)}</div>
          </fieldset>
          <label className={field}>A student who joins during the year<select value={joinRule} onChange={(e) => setJoinRule(e.target.value)} className={INPUT}><option value="due_after_joining">Pays only the dues from the joining month on</option><option value="full">Pays every due of the year</option></select></label>
        </section>

        <section className={CARD} aria-label="Fees in this plan">
          <h2 className={H3}>Fees</h2>
          {heads.length ? null : <p className={`${MUTED} mb-3`}>No fee heads yet. <Link href="/app/fees/heads?next=/app/fees/plans/new" className={LINK}>Add the fees first</Link>, like Tuition, then come back.</p>}
          <ul className="flex flex-col gap-3">
            {lines.map((l) => (
              <li key={l.key} className="rounded-2xl bg-white/[0.04] p-3">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_9rem_auto]">
                  <select aria-label="Fee" value={l.headId} onChange={(e) => setLine(l.key, { headId: e.target.value })} className={INPUT}>{heads.filter((h) => h.id === l.headId || !lines.some((x) => x.headId === h.id)).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
                  <select aria-label={`How often ${headName(l.headId)} is charged`} value={l.schedule} onChange={(e) => setLine(l.key, { schedule: e.target.value as Schedule }, true)} className={INPUT}>{SCHEDULES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
                  <MoneyInput label={`Amount for ${headName(l.headId)}`} labelHidden valuePaise={l.amountPaise} onChange={(p) => setLine(l.key, { amountPaise: p }, true)} />
                  <button type="button" aria-label={`Remove ${headName(l.headId)}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--ds-on-surface-muted)] hover:bg-white/[0.08]"><IconTrash className="h-4 w-4" aria-hidden /></button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" checked={l.optional} onChange={(e) => setLine(l.key, { optional: e.target.checked })} className="accent-[var(--ds-primary)]" />Optional, billed only to students who take it</label>
                  {["monthly", "quarterly", "term"].includes(l.schedule) ? <label className="flex items-center gap-2">The amount is<select value={l.opts.basis} onChange={(e) => setOpts(l, { basis: e.target.value as "each" | "total" })} className="h-9 rounded-lg bg-white/[0.06] px-2"><option value="each">charged each time</option><option value="total">the total for the year</option></select></label> : null}
                  <span className="ml-auto text-[var(--ds-on-surface-muted)]">{l.dues.length} due{l.dues.length === 1 ? "" : "s"}, <Money paise={l.dues.reduce((s, d) => s + d.amountPaise, 0)} size="sm" /> in the year</span>
                </div>
                <details className="mt-2" open={l.schedule === "custom" || undefined}>
                  <summary className="cursor-pointer text-sm underline underline-offset-4">Dates and amounts of each due</summary>
                  <div className="mt-3 flex flex-col gap-3">
                    {l.schedule !== "custom" ? (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className={field}>Due on day<input type="number" min={1} max={31} value={l.opts.dueDay} onChange={(e) => setOpts(l, { dueDay: Number(e.target.value) || 1 })} className={INPUT} /></label>
                        <label className={field}>Bill this many days before<input type="number" min={0} max={90} value={l.opts.leadDays} onChange={(e) => setOpts(l, { leadDays: Number(e.target.value) || 0 })} className={INPUT} /></label>
                        {l.schedule === "term" ? <label className={field}>Terms in the year<input type="number" min={1} max={6} value={l.opts.terms} onChange={(e) => setOpts(l, { terms: Number(e.target.value) || 1 })} className={INPUT} /></label> : null}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-2 text-sm">Add a date<input type="date" min={year.startsOn} max={year.endsOn} onChange={(e) => { if (e.target.value) { addDate(l, e.target.value); e.target.value = ""; } }} className={`${INPUT} w-auto`} /></label>
                        <span className={MUTED}>Dates are kept in order. A date already in the list is not added twice.</span>
                      </div>
                    )}
                    {l.dues.length ? (
                      <div className="custom-scrollbar overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="text-left text-xs text-[var(--ds-on-surface-muted)]"><th className="py-1 font-normal">Due</th><th className="py-1 font-normal">Bill on</th><th className="py-1 font-normal">Due on</th><th className="py-1 text-right font-normal">Amount</th><th className="w-10" /></tr></thead>
                        <tbody>{l.dues.map((d, i) => <tr key={d.dueKey} className="border-t border-white/[0.06]"><td className="py-1.5 pr-2">{d.label}</td>
                          <td className="py-1.5 pr-2"><input type="date" aria-label={`Bill date, ${d.label}`} value={d.billOn} onChange={(e) => setDue(l, i, { billOn: e.target.value })} className={`${INPUT} h-9`} /></td>
                          <td className="py-1.5 pr-2"><input type="date" aria-label={`Due date, ${d.label}`} value={d.dueOn} onChange={(e) => setDue(l, i, { dueOn: e.target.value })} className={`${INPUT} h-9`} /></td>
                          <td className="py-1.5"><MoneyInput label={`Amount, ${d.label}`} labelHidden valuePaise={d.amountPaise} onChange={(p) => setDue(l, i, { amountPaise: p ?? 0 })} /></td>
                          <td className="py-1.5 pl-1">{l.schedule === "custom" ? <button type="button" aria-label={`Remove ${d.label}`} onClick={() => setLine(l.key, { dues: l.dues.filter((_, j) => j !== i) })} className="h-9 w-9 rounded-full hover:bg-white/[0.08]"><IconTrash className="mx-auto h-4 w-4" aria-hidden /></button> : null}</td></tr>)}</tbody></table></div>
                    ) : <p className={MUTED}>{l.amountPaise ? "Add a date above." : "Enter the amount to make the dues."}</p>}
                  </div>
                </details>
              </li>
            ))}
          </ul>
          <Button type="button" variant="ghost" className="mt-3 rounded-full" disabled={!heads.some((h) => !lines.some((l) => l.headId === h.id))} onClick={addLine}><IconPlus className="mr-1 h-4 w-4" aria-hidden />Add a fee</Button>
          <p className={`${MUTED} mt-2`}>Fees that fall due on the same date go on one bill.</p>
        </section>

        <section className={`${CARD} flex flex-col gap-3`} aria-label="Late fee">
          <h2 className={H3}>Late fee</h2>
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
          <p className="text-sm">{lateRuleSentence(rule)} {example.sentence}</p>
        </section>

        <section className={CARD}><label className={field}>Note for the approver (optional)<textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} placeholder="Why the fees changed, the committee decision" className={`${INPUT} h-auto py-2`} /></label></section>
      </div>

      <aside aria-label="Totals" className="flex h-fit min-w-0 flex-col gap-4 lg:sticky lg:top-4">
        <div className={CARD}>
          <h2 className={H3}>What a student pays in the year</h2>
          <Money paise={totals.yearPaise} size="xl" />
          {totals.optionalPaise ? <p className={`${MUTED} mt-1`}>Plus <Money paise={totals.optionalPaise} size="sm" /> if they take every optional fee.</p> : null}
          <ul className="mt-4 divide-y divide-white/[0.06] text-sm">{totals.byHead.map((h) => <li key={h.headId} className="flex justify-between gap-3 py-1.5"><span>{headName(h.headId)}{h.optional ? <span className={MUTED}> (optional)</span> : null}</span><Money paise={h.totalPaise} /></li>)}</ul>
          {totals.byDue.length ? <>
            <h3 className="mb-2 mt-5 text-sm font-medium">Bills through the year</h3>
            <ol className="custom-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-2">{totals.byDue.map((d) => <li key={d.dueKey} className="min-w-28 shrink-0 rounded-2xl bg-white/[0.05] p-3"><p className="text-xs text-[var(--ds-on-surface-muted)]">{d.label}</p><p className="text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{dayLabel(d.dueOn)}</p><Money paise={d.requiredPaise} />{d.optionalPaise ? <p className="text-[11px] text-[var(--ds-on-surface-muted)]">+{(d.optionalPaise / 100).toLocaleString("en-IN")} optional</p> : null}</li>)}</ol>
          </> : null}
        </div>

        {picked.length ? (
          <div className={CARD} aria-label="Compared with last year">
            <h2 className={H3}>Compared with last year</h2>
            <div className="flex flex-col gap-3">{picked.map((c) => <div key={c.classId}><VarianceBar label={c.name} actual={totals.yearPaise} budget={c.fromPaise} /><p className={MUTED}>{c.fromPaise ? `${totals.yearPaise >= c.fromPaise ? "+" : ""}${Math.round(((totals.yearPaise - c.fromPaise) / c.fromPaise) * 1000) / 10}% on last year's ` : ""}<Money paise={c.fromPaise} size="sm" /></p></div>)}</div>
          </div>
        ) : null}

        <div className={`${CARD} flex flex-col gap-2`}>
          {problems.length ? <ul className="list-disc pl-5 text-sm text-[var(--ds-color-warning-400)]">{problems.slice(0, 4).map((p) => <li key={p}>{p}</li>)}</ul> : null}
          {error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
          <Button type="button" className="rounded-full" isLoading={pending} disabled={!!problems.length} onClick={() => save("submit")}>Save and send for approval</Button>
          <Button type="button" variant="secondary" className="rounded-full" disabled={pending || !!problems.length} onClick={() => save("stay")}>Save as draft<kbd className="ml-2 hidden rounded bg-white/10 px-1.5 text-[10px] sm:inline">Ctrl S</kbd></Button>
          <div className="flex justify-between text-sm"><Link href={plan ? `/app/fees/plans/${plan.id}` : "/app/fees/plans"} className="py-2 text-[var(--ds-on-surface-muted)] underline underline-offset-4">Cancel</Link>{planId && !plan ? <button type="button" onClick={discard} className="py-2 text-[var(--ds-on-surface-muted)] underline underline-offset-4">Delete draft</button> : null}</div>
          <p className={MUTED}>An approver publishes the plan. Nothing is billed until then, and a published plan is never edited: change it with a new version.</p>
        </div>
      </aside>
    </div>
  );
}
