"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { RecordPicker, type PickerOption } from "@smw/ui/finance/RecordPicker";
import { findStudents, removeStudentOptIn, removeStudentOverride, setOptIns, setStudentPlan } from "./actions";
import { shortDate } from "@smw/ui/format";
import { CARD, H3, MUTED } from "./styles";

export interface OverrideRow { id: string; studentId: string; name: string; admissionNo: string; classLabel: string; reason: string; since: Date }
export interface OptInRow { studentId: string; name: string; admissionNo: string; classLabel: string; since: Date; heads: { id: string; name: string }[] }
interface Listed<T> { rows: T[]; total: number }

/** One student on another plan, and the optional fees a student takes, with who is on each now. Bills already issued are not touched. */
export function PlanStudents({ rootId, planName, optionalHeads, overrides, optIns, q }: { rootId: string; planName: string; optionalHeads: { id: string; name: string }[]; overrides: Listed<OverrideRow>; optIns: Listed<OptInRow>; q: string }) {
  const router = useRouter();
  const [mover, setMover] = useState<PickerOption | undefined>(), [reason, setReason] = useState(""), [moveErr, setMoveErr] = useState("");
  const [taker, setTaker] = useState<PickerOption | undefined>(), [heads, setHeads] = useState<string[]>([]), [takeErr, setTakeErr] = useState("");
  const [pending, start] = useTransition();
  const move = () => start(async () => {
    if (!mover) return void setMoveErr("Pick the student.");
    const fd = new FormData(); fd.set("studentId", mover.id); fd.set("rootId", rootId); fd.set("reason", reason);
    const r = await setStudentPlan(fd);
    if (!r.ok) return void setMoveErr(r.error);
    toast(r.message ?? "Done"); setMoveErr(""); setReason(""); router.refresh();
  });
  const take = () => start(async () => {
    if (!taker) return void setTakeErr("Pick the student.");
    const fd = new FormData(); fd.set("studentId", taker.id); for (const h of heads) fd.append("headIds", h);
    const r = await setOptIns(fd);
    if (!r.ok) return void setTakeErr(r.error);
    toast(r.message ?? "Done"); setTakeErr(""); router.refresh();
  });
  const drop = (act: typeof removeStudentOverride, fields: Record<string, string>) => start(async () => {
    const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    const r = await act(fd);
    if (!r.ok) return void toast(r.error, "danger");
    toast(r.message ?? "Done"); router.refresh();
  });
  return (
    <div className="flex flex-col gap-5">
    <form method="get" role="search" className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="tab" value="students" />
      <input name="q" defaultValue={q} placeholder="Search name or admission number" aria-label="Search students on this plan" className={`${INPUT} max-w-sm`} />
      <Button type="submit" variant="secondary" className="rounded-full">Search</Button>
      {q ? <a href="?tab=students" className="text-sm underline underline-offset-4">Clear</a> : null}
    </form>
    <div className="grid gap-5 lg:grid-cols-2">
      <section className={`${CARD} flex flex-col gap-3`}>
        <h2 className={H3}>Put one student on {planName}</h2>
        <p className={MUTED}>For a student whose class has a different plan, like a scholarship plan. The class plan stops applying to them for the year. Bills already issued stay as they are. Taking money off what they owe may need an approver.</p>
        <RecordPicker action={findStudents} name="studentId" label="Student" onChange={(p) => setMover(p[0])} hotkey={false} error={moveErr || undefined} />
        <label className="flex flex-col gap-1.5 text-sm">Why<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Staff child, scholarship" className={INPUT} /></label>
        <div><Button type="button" className="rounded-full" isLoading={pending} onClick={move}>Move to this plan</Button></div>
      </section>
      <section className={`${CARD} flex flex-col gap-3`}>
        <h2 className={H3}>Optional fees a student takes</h2>
        {optionalHeads.length ? <>
          <p className={MUTED}>Ticked fees are billed to this student from the next bill. Saving replaces their earlier choice.</p>
          <RecordPicker action={findStudents} name="studentId" label="Student" onChange={(p) => setTaker(p[0])} hotkey={false} error={takeErr || undefined} />
          <div className="flex flex-wrap gap-2">{optionalHeads.map((h) => <label key={h.id} className="flex cursor-pointer items-center gap-2 rounded-full bg-white/[0.05] px-3 py-1.5 text-sm has-[:checked]:bg-white/[0.14]"><input type="checkbox" checked={heads.includes(h.id)} onChange={() => setHeads((x) => (x.includes(h.id) ? x.filter((i) => i !== h.id) : [...x, h.id]))} className="accent-[var(--ds-primary)]" />{h.name}</label>)}</div>
          <div><Button type="button" variant="secondary" className="rounded-full" isLoading={pending} onClick={take}>Save choice</Button></div>
        </> : <p className={MUTED}>This plan has no optional fees. Mark a fee as optional in the plan to let students choose it.</p>}
      </section>
      <section className={`${CARD} flex flex-col gap-3`} aria-label="Students on this plan by hand">
        <h2 className={H3}>On this plan by hand ({overrides.total})</h2>
        {overrides.rows.length ? <ul className="divide-y divide-white/[0.06] text-sm">{overrides.rows.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0"><Link href={`/app/fees/students/${o.studentId}`} className="underline underline-offset-4">{o.name}</Link> <span className={MUTED}>{o.admissionNo} · {o.classLabel}</span><span className={`${MUTED} block`}>{o.reason}, since {shortDate(new Date(o.since).toISOString().slice(0, 10))}</span></span>
            <Button type="button" variant="ghost" className="rounded-full" disabled={pending} onClick={() => drop(removeStudentOverride, { studentId: o.studentId })}>Back to class plan</Button>
          </li>))}</ul> : <p className={MUTED}>{q ? "Nobody matches that search." : "Nobody. Every student follows their class's plan."}</p>}
        {overrides.total > overrides.rows.length ? <p className={MUTED}>Showing {overrides.rows.length} of {overrides.total}. Search to find the rest.</p> : null}
      </section>
      <section className={`${CARD} flex flex-col gap-3`} aria-label="Students taking optional fees">
        <h2 className={H3}>Taking optional fees ({optIns.total})</h2>
        {optIns.rows.length ? <ul className="divide-y divide-white/[0.06] text-sm">{optIns.rows.map((o) => (
          <li key={o.studentId} className="flex flex-col gap-1 py-2">
            <span><Link href={`/app/fees/students/${o.studentId}`} className="underline underline-offset-4">{o.name}</Link> <span className={MUTED}>{o.admissionNo} · {o.classLabel} · since {shortDate(new Date(o.since).toISOString().slice(0, 10))}</span></span>
            <span className="flex flex-wrap gap-2">{o.heads.map((h) => <span key={h.id} className="inline-flex items-center gap-1 rounded-full bg-white/[0.07] py-1 pl-3 pr-1 text-xs">{h.name}<button type="button" aria-label={`Stop billing ${h.name} to ${o.name}`} disabled={pending} onClick={() => drop(removeStudentOptIn, { studentId: o.studentId, headId: h.id })} className="h-6 w-6 rounded-full hover:bg-white/[0.12]">×</button></span>)}</span>
          </li>))}</ul> : <p className={MUTED}>{q ? "Nobody matches that search." : optionalHeads.length ? "Nobody takes an optional fee yet." : "This plan has no optional fees."}</p>}
        {optIns.total > optIns.rows.length ? <p className={MUTED}>Showing {optIns.rows.length} of {optIns.total}. Search to find the rest.</p> : null}
      </section>
    </div>
    </div>
  );
}
