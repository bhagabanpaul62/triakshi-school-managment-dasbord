"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { Modal, ModalField, ModalFooter } from "@smw/ui/kit/Modal";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { Money } from "@smw/ui/finance/Money";
import { MoneyInput } from "@smw/ui/finance/MoneyInput";
import { RecordPicker, type PickerOption } from "@smw/ui/finance/RecordPicker";
import { concessionsOn } from "../calc";
import { findStudents, openBillsOf, proposeConcession, resubmitConcession } from "./actions";
import { MUTED } from "./styles";

export interface ConcessionType { id: string; name: string; mode: "percent" | "amount"; value: number; headId: string | null; per: "bill" | "year" }
export interface ConcessionFormProps {
  types: ConcessionType[];
  heads: { id: string; name: string }[];
  /** Fixed student (from a student's page or a suggestion). */
  student?: PickerOption;
  /** A refused request being edited and sent again. */
  again?: { id: string; typeId: string | null; headId: string | null; mode: "percent" | "amount"; value: number; per: "bill" | "year"; reason: string };
  label?: string;
  variant?: "default" | "secondary" | "ghost";
  initialOpen?: boolean;
}
type Bill = { id: string; number: string | null; label: string; dueDate: string; lines: { headId: string | null; kind: string; amountPaise: number }[] };

/** A concession for one student. Before it is saved, each open bill shows what it would take off. Under the school's limit it applies at once; above it, it waits for an approver. */
export function ConcessionForm({ types, heads, student, again, label = "New concession", variant = "default", initialOpen }: ConcessionFormProps) {
  const router = useRouter(), uid = useId();
  const [open, setOpen] = useState(!!initialOpen);
  const [picked, setPicked] = useState<PickerOption | undefined>(student);
  const [typeId, setTypeId] = useState(again?.typeId ?? "");
  const [headId, setHeadId] = useState(again?.headId ?? "");
  const [mode, setMode] = useState<"percent" | "amount">(again?.mode ?? "percent");
  const [percent, setPercent] = useState(again?.mode === "percent" ? String(again.value / 100) : "");
  const [amount, setAmount] = useState<number | null>(again?.mode === "amount" ? again.value : null);
  const [per, setPer] = useState<"bill" | "year">(again?.per ?? "year");
  const [reason, setReason] = useState(again?.reason ?? "");
  const [bills, setBills] = useState<Bill[] | null>(null);
  const [error, setError] = useState(""), [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || !picked) { setBills(null); return; }
    let live = true;
    void openBillsOf(picked.id).then((r) => { if (live) setBills(r.ok ? (r.data as Bill[]) : []); });
    return () => { live = false; };
  }, [open, picked]);

  const value = mode === "percent" ? Math.round((Number(percent) || 0) * 100) : amount ?? 0;
  const effect = (bills ?? []).map((b) => {
    const cut = concessionsOn(b.lines, value > 0 ? [{ headId: headId || null, mode, value }] : []);
    const before = b.lines.reduce((s, l) => s + l.amountPaise, 0), off = cut.reduce((s, c) => s + c, 0);
    return { ...b, before, off };
  });
  const pick = (id: string) => {
    setTypeId(id);
    const t = types.find((x) => x.id === id);
    if (t) { setMode(t.mode); setHeadId(t.headId ?? ""); setPer(t.per); if (t.mode === "percent") setPercent(String(t.value / 100)); else setAmount(t.value); }
  };

  const send = () => start(async () => {
    setError(""); setErrors({});
    if (!picked) { setErrors({ studentId: "Pick the student." }); return; }
    const fd = new FormData();
    fd.set("studentId", picked.id); fd.set("mode", mode); fd.set("value", String(value)); fd.set("per", per); fd.set("reason", reason);
    if (typeId) fd.set("typeId", typeId);
    if (headId) fd.set("headId", headId);
    if (again) fd.set("id", again.id);
    const r = await (again ? resubmitConcession(fd) : proposeConcession(fd));
    if (!r.ok) { setError(r.error); setErrors(r.fieldErrors ?? {}); return; }
    toast(r.message ?? "Done"); setOpen(false); router.refresh();
  });

  return (
    <>
      <Button type="button" variant={variant} className="rounded-full" onClick={() => { setError(""); setOpen(true); }}>{label}</Button>
      <Modal open={open} onOpenChange={setOpen} size="lg" title={again ? "Edit and send again" : "New concession"} description="A discount for one student for the year. Bills made from the plans carry it from now on, and open bills are cut by a credit note." dismissOnOutsideClick={false}
        footer={<ModalFooter summary={<span className="text-sm">{value ? `${mode === "percent" ? `${Number(percent)}%` : `₹${(value / 100).toLocaleString("en-IN")}`} off${headId ? ` ${heads.find((h) => h.id === headId)?.name ?? ""}` : " every fee"}` : "Set the discount"}</span>} secondary={{ onClick: () => setOpen(false) }} primary={{ label: again ? "Send again" : "Save concession", onClick: send, loading: pending }} />}>
        <div className="flex flex-col gap-4 pt-2">
          {again || student ? <p className="text-sm">For <b>{picked?.label}</b>{picked?.meta ? <span className={MUTED}> · {picked.meta}</span> : null}</p>
            : <RecordPicker action={findStudents} name="studentId" label="Student" required onChange={(p) => setPicked(p[0])} initial={[]} error={errors.studentId} hotkey={false} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <ModalField label="Kind of concession" htmlFor={`${uid}-t`}><select id={`${uid}-t`} value={typeId} onChange={(e) => pick(e.target.value)} className={INPUT}><option value="">Other (set it yourself)</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></ModalField>
            <ModalField label="Applies to" htmlFor={`${uid}-h`}><select id={`${uid}-h`} value={headId} onChange={(e) => setHeadId(e.target.value)} className={INPUT}><option value="">Every fee that can be discounted</option>{heads.map((h) => <option key={h.id} value={h.id}>{h.name} only</option>)}</select></ModalField>
            <ModalField label="How much" htmlFor={`${uid}-m`}><select id={`${uid}-m`} value={mode} onChange={(e) => setMode(e.target.value as "percent" | "amount")} className={INPUT}><option value="percent">A percent</option><option value="amount">An amount</option></select></ModalField>
            {mode === "percent" ? <ModalField label="Percent off" htmlFor={`${uid}-p`} error={errors.value}><input id={`${uid}-p`} inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="10" className={INPUT} /></ModalField>
              : <MoneyInput label="Amount off" valuePaise={amount} onChange={setAmount} error={errors.value} />}
            {mode === "amount" ? <ModalField label="The amount is" htmlFor={`${uid}-a`}><select id={`${uid}-a`} value={per} onChange={(e) => setPer(e.target.value as "bill" | "year")} className={INPUT}><option value="year">For the whole year, spread over the bills</option><option value="bill">Off every bill</option></select></ModalField> : null}
          </div>
          <ModalField label="Why" htmlFor={`${uid}-w`} required error={errors.reason}><input id={`${uid}-w`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Second child, merit scholarship" className={INPUT} /></ModalField>

          <section aria-label="What it does to each open bill" className="rounded-2xl bg-white/[0.04] p-3">
            <h3 className="mb-2 text-sm font-medium">What it does to each open bill</h3>
            {!picked ? <p className={MUTED}>Pick the student to see their open bills.</p> : bills === null ? <p className={MUTED}>Looking at their bills...</p> : !effect.length ? <p className={MUTED}>This student has no open bills. The concession will apply to the bills made from now on.</p> : (
              <div className="custom-scrollbar overflow-x-auto"><table className="w-full min-w-[420px] text-sm"><thead><tr className="text-left text-xs text-[var(--ds-on-surface-muted)]"><th className="py-1 font-normal">Bill</th><th className="py-1 text-right font-normal">Open now</th><th className="py-1 text-right font-normal">Concession</th><th className="py-1 text-right font-normal">After</th></tr></thead>
                <tbody>{effect.map((b) => <tr key={b.id} className="border-t border-white/[0.06]"><td className="py-1.5">{b.number ?? b.label}<span className={`${MUTED} ml-2`}>{b.label}</span></td><td className="py-1.5 text-right"><Money paise={b.before} /></td><td className="py-1.5 text-right"><Money paise={b.off ? -b.off : null} tone="success" /></td><td className="py-1.5 text-right"><Money paise={b.before - b.off} /></td></tr>)}</tbody></table></div>
            )}
            <p className={`${MUTED} mt-2`}>Late fee and refundable deposits are never discounted. A discount above the school's limit waits for an approver, and nothing changes until then.</p>
          </section>
          {error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
        </div>
      </Modal>
    </>
  );
}
