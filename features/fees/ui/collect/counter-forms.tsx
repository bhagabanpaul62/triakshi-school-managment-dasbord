"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalFooter, ModalSection } from "@smw/ui/kit/Modal";
import { Button } from "@smw/ui/ui/button";
import { toast } from "@smw/ui/shell/toast";
import { INPUT } from "@smw/ui/shell/FormModal";
import { Money } from "@smw/ui/finance/Money";
import { MoneyInput } from "@smw/ui/finance/MoneyInput";
import { closeCounter } from "../collect-actions";
import { DENOMINATIONS, denominationTotal, nonZero } from "./logic";

/** Close the day: count notes and coins (or type one total), see the difference, say why if there is one. */
export function CloseCounter({ expectedPaise, counterId, primary = false }: { expectedPaise: number; counterId: string; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [typed, setTyped] = useState<number | null>(null);
  const [byTotal, setByTotal] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const counted = byTotal ? (typed ?? 0) : denominationTotal(counts);
  const diff = counted - expectedPaise;

  const submit = () => start(async () => {
    if (diff !== 0 && !reason.trim()) { setError(`The box should hold ${(expectedPaise / 100).toLocaleString("en-IN")} rupees. Say why it is ${diff < 0 ? "short" : "over"}.`); return; }
    setError("");
    const r = await closeCounter({ countedPaise: counted, denominations: byTotal ? undefined : nonZero(counts), differenceReason: reason.trim() || undefined });
    if (!r.ok) { setError(r.error); toast(r.error, "danger"); return; }
    toast(r.data.differencePaise === 0 ? "Counter closed. The box matches." : "Counter closed. The difference is recorded.");
    setOpen(false);
    router.push(`/app/fees/counter?closed=${r.data.id}`);
    router.refresh();
  });

  return (
    <>
      <Button type="button" variant={primary ? "default" : "secondary"} className="rounded-full" onClick={() => setOpen(true)} data-counter={counterId}>Close counter</Button>
      <Modal open={open} onOpenChange={setOpen} size="lg" title="Close the counter" description="Count what is in the box. A closed day takes no more money." dismissOnOutsideClick={false}
        footer={<ModalFooter summary={<span>Expected <Money paise={expectedPaise} size="sm" /> · Counted <Money paise={counted} size="sm" /></span>} secondary={{ onClick: () => setOpen(false) }} primary={{ label: "Close counter", onClick: submit, loading: pending }} />}>
        <div className="flex flex-col gap-6 pt-2">
          <ModalSection title={byTotal ? "Total counted" : "Notes and coins"}>
            {byTotal ? (
              <MoneyInput label="Cash counted" valuePaise={typed} onChange={setTyped} />
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {DENOMINATIONS.map((d) => (
                  <li key={d.paise} className="flex flex-col gap-1">
                    <label htmlFor={`d-${d.paise}`} className="text-xs text-[var(--ds-on-surface-variant)]">{d.label}</label>
                    <input id={`d-${d.paise}`} inputMode="numeric" min={0} type="number" className={INPUT} value={counts[d.paise] ?? ""} placeholder="0"
                      onChange={(e) => setCounts({ ...counts, [d.paise]: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} />
                    <span className="text-xs tabular-nums text-[var(--ds-on-surface-muted)]"><Money paise={d.paise * (counts[d.paise] ?? 0)} size="sm" /></span>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" onClick={() => setByTotal(!byTotal)} className="w-fit text-xs text-[var(--ds-on-surface-muted)] underline underline-offset-4">{byTotal ? "Count by notes and coins instead" : "I only have one total"}</button>
          </ModalSection>
          <ModalSection title="Result">
            <div className="grid grid-cols-3 gap-3 rounded-2xl bg-white/[0.04] p-4 text-sm">
              <div><p className="text-xs text-[var(--ds-on-surface-muted)]">Should be</p><Money paise={expectedPaise} size="lg" /></div>
              <div><p className="text-xs text-[var(--ds-on-surface-muted)]">Counted</p><Money paise={counted} size="lg" /></div>
              <div><p className="text-xs text-[var(--ds-on-surface-muted)]">Difference</p><Money paise={diff} size="lg" sign="always" tone={diff === 0 ? "success" : "danger"} /></div>
            </div>
            {diff !== 0 ? (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="diff-reason" className="text-[13px] font-medium text-[var(--ds-on-surface-variant)]">Why is it {diff < 0 ? "short" : "over"}?</label>
                <textarea id="diff-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={`${INPUT} h-auto py-2`} placeholder="For example: Rs. 100 given back as change twice" />
              </div>
            ) : null}
            {error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
          </ModalSection>
        </div>
      </Modal>
    </>
  );
}
