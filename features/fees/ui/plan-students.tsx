"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { RecordPicker, type PickerOption } from "@smw/ui/finance/RecordPicker";
import { findStudents, setOptIns, setStudentPlan } from "./actions";
import { CARD, H3, MUTED } from "./styles";

/** One student on another plan, and the optional fees a student takes. Bills already issued are not touched. */
export function PlanStudents({ rootId, planName, optionalHeads }: { rootId: string; planName: string; optionalHeads: { id: string; name: string }[] }) {
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
  return (
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
    </div>
  );
}
