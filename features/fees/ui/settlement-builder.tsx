"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { Modal, ModalField, ModalFooter } from "@smw/ui/kit/Modal";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { Money } from "@smw/ui/finance/Money";
import { MoneyInput } from "@smw/ui/finance/MoneyInput";
import { previewSettlement, proposeSettlement, resubmitSettlement } from "./actions";
import { addMonthsKeepDay, splitIntoParts } from "./logic";
import { MUTED } from "./styles";

export interface SettlementBill { id: string; number: string | null; label: string; openPaise: number; accruedLatePaise: number; dueDate: string }
export interface SettlementPlan { reason: string; invoiceIds?: string[]; waiveLate: boolean; useAdvancePaise: number; useDepositPaise: number; writeOffPaise: number; finalPaise?: number; parts: { dueOn: string; amountPaise: number }[] }
interface Result { openBeforePaise: number; waivedLatePaise: number; advancePaise: number; depositPaise: number; writtenOffPaise: number; remainingPaise: number; parts: { invoiceId: string; dueOn: string; amountPaise: number }[] }
type Part = { dueOn: string; amountPaise: number };

/**
 * One deal on a student's dues, shown as it will be: waive the late fee, use the advance or deposit, write off or agree a
 * final amount, split what is left into dated parts. The numbers come from the same run approval would do, rolled back.
 */
export function SettlementBuilder({ studentId, studentName, bills, advancePaise, depositPaise, today, again, label = "Settlement" }: { studentId: string; studentName: string; bills: SettlementBill[]; advancePaise: number; depositPaise: number; today: string; again?: { id: string; plan: SettlementPlan }; label?: string }) {
  const router = useRouter(), uid = useId();
  const p = again?.plan;
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>(p?.invoiceIds ?? bills.map((b) => b.id));
  const [waive, setWaive] = useState(p?.waiveLate ?? false);
  const [useAdvance, setUseAdvance] = useState<number | null>(p?.useAdvancePaise || null), [useDeposit, setUseDeposit] = useState<number | null>(p?.useDepositPaise || null);
  const [how, setHow] = useState<"none" | "writeoff" | "final">(p?.finalPaise !== undefined ? "final" : p?.writeOffPaise ? "writeoff" : "none");
  const [writeOff, setWriteOff] = useState<number | null>(p?.writeOffPaise || null), [finalPay, setFinalPay] = useState<number | null>(p?.finalPaise ?? null);
  const [count, setCount] = useState(p?.parts.length || 1);
  const [first, setFirst] = useState(p?.parts[0]?.dueOn ?? addMonthsKeepDay(today, 1));
  const [edited, setEdited] = useState<Part[] | null>(p?.parts.length ? p.parts : null);
  const [reason, setReason] = useState(p?.reason ?? "");
  const [base, setBase] = useState<Result | null>(null), [final, setFinal] = useState<Result | null>(null);
  const [error, setError] = useState(""), [previewErr, setPreviewErr] = useState("");
  const [pending, start] = useTransition();
  const seq = useRef(0);

  const inputs = { studentId, reason: reason.trim() || "Settlement", invoiceIds: picked, waiveLate: waive, useAdvancePaise: Math.min(useAdvance ?? 0, advancePaise), useDepositPaise: Math.min(useDeposit ?? 0, depositPaise),
    writeOffPaise: how === "writeoff" ? writeOff ?? 0 : 0, ...(how === "final" && finalPay !== null ? { finalPaise: finalPay } : {}) };
  const key = JSON.stringify(inputs);
  // Without parts first, to learn what is left to pay; the parts then split that.
  useEffect(() => {
    if (!open || !picked.length) { setBase(null); return; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const r = await previewSettlement(JSON.stringify({ ...inputs, parts: [] }));
      if (mine !== seq.current) return;
      if (r.ok) { setBase(r.data as Result); setPreviewErr(""); } else { setBase(null); setPreviewErr(r.error); }
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  const remaining = base?.remainingPaise ?? 0;
  const parts: Part[] = count > 1 ? (edited && edited.length === count ? edited : splitIntoParts(remaining, count, first)) : [];
  const partsSum = parts.reduce((s, x) => s + x.amountPaise, 0), partsOk = count <= 1 || partsSum === remaining;
  const partsKey = JSON.stringify(parts);
  useEffect(() => {
    if (!open || !base || count <= 1 || !partsOk) { setFinal(null); return; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const r = await previewSettlement(JSON.stringify({ ...inputs, parts }));
      if (mine !== seq.current) return;
      if (r.ok) { setFinal(r.data as Result); setPreviewErr(""); } else { setFinal(null); setPreviewErr(r.error); }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, base, partsKey, count]);

  const shown = count > 1 && final ? final : base;
  const send = () => start(async () => {
    setError("");
    if (reason.trim().length < 5) { setError("Say why, in at least a few words. The approver reads it."); return; }
    if (!picked.length) { setError("Pick at least one bill."); return; }
    if (!partsOk) { setError(`The parts add up to ₹${(partsSum / 100).toLocaleString("en-IN")}, but ₹${(remaining / 100).toLocaleString("en-IN")} is left to pay.`); return; }
    const body = { ...inputs, reason: reason.trim(), parts };
    const r = await (again ? resubmitSettlement(JSON.stringify({ ...body, settlementId: again.id })) : proposeSettlement(JSON.stringify(body)));
    if (!r.ok) { setError(r.error); return; }
    toast(r.message ?? "Sent for approval"); setOpen(false); router.refresh();
  });
  const setPart = (i: number, patch: Partial<Part>) => setEdited(parts.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const rows: [string, number | undefined, boolean?][] = shown ? [["Open now", shown.openBeforePaise], ["Late fee waived", -shown.waivedLatePaise], ["Advance used", -shown.advancePaise], ["Deposit used", -shown.depositPaise], ["Written off", -shown.writtenOffPaise]] : [];

  return (
    <>
      <Button type="button" variant={again ? "ghost" : "secondary"} className="rounded-full" onClick={() => { setError(""); setOpen(true); }}>{again ? "Edit and resend" : label}</Button>
      <Modal open={open} onOpenChange={setOpen} size="xl" title={`Settlement for ${studentName}`} description="One deal on what this student owes. It is approved as a whole, and nothing changes until then." dismissOnOutsideClick={false}
        footer={<ModalFooter summary={<span className="flex items-center gap-2 text-sm">Family pays <Money paise={shown?.remainingPaise ?? 0} size="lg" /></span>} secondary={{ onClick: () => setOpen(false) }} primary={{ label: "Send for approval", onClick: send, loading: pending }} />}>
        <div className="grid gap-5 pt-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
          <div className="flex min-w-0 flex-col gap-4">
            <fieldset><legend className="mb-2 text-sm font-medium">Bills in the deal</legend>
              <ul className="flex flex-col gap-1">{bills.map((b) => <li key={b.id}><label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl bg-white/[0.04] px-3 py-2 text-sm"><span className="flex items-center gap-3"><input type="checkbox" checked={picked.includes(b.id)} onChange={() => setPicked((x) => (x.includes(b.id) ? x.filter((i) => i !== b.id) : [...x, b.id]))} className="accent-[var(--ds-primary)]" /><span>{b.number ?? b.label}<span className={`${MUTED} ml-2`}>{b.label}, due {b.dueDate}</span></span></span><Money paise={b.openPaise + b.accruedLatePaise} /></label></li>)}</ul>
            </fieldset>
            <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={waive} onChange={(e) => setWaive(e.target.checked)} className="accent-[var(--ds-primary)]" />Waive the late fee (built up and charged)</label>
            <div className="grid gap-3 sm:grid-cols-2">
              <MoneyInput label={`Use the advance (holds ₹${(advancePaise / 100).toLocaleString("en-IN")})`} valuePaise={useAdvance} onChange={setUseAdvance} max={advancePaise} />
              <MoneyInput label={`Use the deposit (holds ₹${(depositPaise / 100).toLocaleString("en-IN")})`} valuePaise={useDeposit} onChange={setUseDeposit} max={depositPaise} />
            </div>
            <fieldset className="flex flex-col gap-2"><legend className="mb-1 text-sm font-medium">What the school gives up</legend>
              {([["none", "Nothing, the family pays what is left"], ["writeoff", "Write off an amount"], ["final", "Agree a final amount the family pays, the rest is written off"]] as const).map(([v, t]) => <label key={v} className="flex items-center gap-3 text-sm"><input type="radio" name={`${uid}-how`} checked={how === v} onChange={() => setHow(v)} className="accent-[var(--ds-primary)]" />{t}</label>)}
              {how === "writeoff" ? <MoneyInput label="Write off" valuePaise={writeOff} onChange={setWriteOff} /> : null}
              {how === "final" ? <MoneyInput label="The family pays" valuePaise={finalPay} onChange={setFinalPay} /> : null}
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <ModalField label="Pay in how many parts" htmlFor={`${uid}-n`}><select id={`${uid}-n`} value={count} onChange={(e) => { setCount(Number(e.target.value)); setEdited(null); }} className={INPUT}>{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n === 1 ? "All at once, on the bill's dates" : `${n} parts, a month apart`}</option>)}</select></ModalField>
              {count > 1 ? <ModalField label="First part on" htmlFor={`${uid}-f`}><input id={`${uid}-f`} type="date" min={today} value={first} onChange={(e) => { setFirst(e.target.value); setEdited(null); }} className={INPUT} /></ModalField> : null}
            </div>
            {count > 1 ? (
              <ol aria-label="Payment calendar" className="flex flex-col gap-2">{parts.map((x, i) => <li key={i} className="grid grid-cols-[1fr_9rem] items-center gap-2 rounded-xl bg-white/[0.04] p-2"><input type="date" aria-label={`Part ${i + 1} date`} min={today} value={x.dueOn} onChange={(e) => setPart(i, { dueOn: e.target.value })} className={INPUT} /><MoneyInput label={`Part ${i + 1} amount`} labelHidden valuePaise={x.amountPaise} onChange={(v) => setPart(i, { amountPaise: v ?? 0 })} /></li>)}
                <li className={partsOk ? MUTED : "text-sm text-[var(--ds-color-danger-400)]"}>{partsOk ? `The parts add up to what is left to pay.` : `The parts add up to ₹${(partsSum / 100).toLocaleString("en-IN")}, but ₹${(remaining / 100).toLocaleString("en-IN")} is left. Change an amount.`}</li></ol>
            ) : null}
            <ModalField label="Why" htmlFor={`${uid}-w`} required error={error || undefined}><textarea id={`${uid}-w`} rows={2} value={reason} onChange={(e) => { setReason(e.target.value); setError(""); }} placeholder="The family lost a job and agreed to pay in parts" className={`${INPUT} h-auto py-2`} /></ModalField>
          </div>

          <aside aria-label="Before and after" className="h-fit rounded-2xl bg-white/[0.04] p-4">
            <h3 className="mb-2 text-sm font-medium">Before and after</h3>
            {previewErr ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{previewErr}</p> : !shown ? <p className={MUTED}>{picked.length ? "Working it out..." : "Pick at least one bill."}</p> : (
              <dl className="flex flex-col gap-1 text-sm">
                {rows.map(([k, v]) => v === 0 && k !== "Open now" ? null : <div key={k} className="flex justify-between gap-3"><dt className="text-[var(--ds-on-surface-muted)]">{k}</dt><dd><Money paise={v} /></dd></div>)}
                <div className="mt-1 flex justify-between gap-3 border-t border-white/[0.12] pt-2 font-medium"><dt>Family pays</dt><dd><Money paise={shown.remainingPaise} size="lg" /></dd></div>
                {shown.parts.length ? <div className="mt-3"><dt className={`${MUTED} mb-1`}>Dated parts</dt>{shown.parts.map((x, i) => <dd key={i} className="flex justify-between"><span>{x.dueOn}</span><Money paise={x.amountPaise} /></dd>)}</div> : null}
              </dl>
            )}
            <p className={`${MUTED} mt-3`}>Reminders and the late fee follow the new dates from the day it is approved.</p>
          </aside>
        </div>
      </Modal>
    </>
  );
}
