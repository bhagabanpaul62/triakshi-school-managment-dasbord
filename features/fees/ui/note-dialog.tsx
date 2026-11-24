"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { Modal, ModalField, ModalFooter } from "@smw/ui/kit/Modal";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { Money } from "@smw/ui/finance/Money";
import { MoneyInput } from "@smw/ui/finance/MoneyInput";
import { proposeNote } from "./actions";

export interface NoteLineChoice { id: string; label: string; openPaise: number }
const REASONS = [["concession", "Concession (a discount)"], ["waiver", "Waive (a late fee or charge)"], ["write_off", "Write off (it will not be collected)"], ["correction", "Correction (it was billed wrongly)"]] as const;

/** A credit note takes money off the open part of a bill, line by line; a debit note adds a charge. Small ones apply at once, larger ones wait for an approver. */
export function NoteDialog({ invoiceId, kind, lines, heads, label }: { invoiceId: string; kind: "credit" | "debit"; lines: NoteLineChoice[]; heads: { id: string; name: string }[]; label: string }) {
  const [open, setOpen] = useState(false);
  const [reasonType, setReasonType] = useState<(typeof REASONS)[number][0]>(kind === "credit" ? "concession" : "correction");
  const [reason, setReason] = useState("");
  const [amounts, setAmounts] = useState<Record<string, number | null>>(() => Object.fromEntries(lines.map((l) => [l.id, l.openPaise])));
  const [add, setAdd] = useState<{ headId: string; label: string; amountPaise: number | null }>({ headId: heads[0]?.id ?? "", label: "", amountPaise: null });
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const id = useId();
  const total = kind === "credit" ? lines.reduce((s, l) => s + Math.min(amounts[l.id] ?? 0, l.openPaise), 0) : add.amountPaise ?? 0;

  const send = () => start(async () => {
    if (!total) { setError(kind === "credit" ? "Enter how much to take off." : "Enter the amount."); return; }
    const r = await proposeNote(JSON.stringify(kind === "credit"
      ? { invoiceId, kind, reasonType, reason, lines: lines.filter((l) => (amounts[l.id] ?? 0) > 0).map((l) => ({ lineId: l.id, amountPaise: Math.min(amounts[l.id]!, l.openPaise) })) }
      : { invoiceId, kind, reasonType: "correction", reason, add: { headId: add.headId || undefined, label: add.label || heads.find((h) => h.id === add.headId)?.name || "Charge", amountPaise: add.amountPaise } }));
    if (!r.ok) { setError(r.error); return; }
    toast(r.message ?? "Done"); setOpen(false); setReason(""); setError(""); router.refresh();
  });

  return (
    <>
      <Button type="button" variant="secondary" className="rounded-full" onClick={() => { setError(""); setOpen(true); }}>{label}</Button>
      <Modal open={open} onOpenChange={setOpen} size="md" title={label} description={kind === "credit" ? "Take money off what is still open on this bill. The bill itself is never edited." : "Add a charge to this bill."} dismissOnOutsideClick={false}
        footer={<ModalFooter summary={<span className="flex items-center gap-2 text-sm">{kind === "credit" ? "Takes off" : "Adds"} <Money paise={total} size="lg" /></span>} secondary={{ onClick: () => setOpen(false) }} primary={{ label: kind === "credit" ? "Save credit note" : "Save debit note", onClick: send, loading: pending }} />}>
        <div className="flex flex-col gap-4 pt-2">
          {kind === "credit" ? (
            <>
              <ModalField label="Why" htmlFor={`${id}-type`}>
                <select id={`${id}-type`} value={reasonType} onChange={(e) => setReasonType(e.target.value as typeof reasonType)} className={INPUT}>{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </ModalField>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-sm font-medium">How much off each line</legend>
                {lines.map((l) => (
                  <div key={l.id} className="grid items-center gap-2 rounded-2xl bg-white/[0.04] p-3 sm:grid-cols-[1fr_9rem]">
                    <span className="min-w-0 text-sm"><span className="block truncate">{l.label}</span><span className="text-xs text-[var(--ds-on-surface-muted)]">Open <Money paise={l.openPaise} size="sm" /></span></span>
                    <MoneyInput label={`Amount off ${l.label}`} labelHidden valuePaise={amounts[l.id] ?? null} max={l.openPaise} onChange={(p) => setAmounts((a) => ({ ...a, [l.id]: p }))} />
                  </div>
                ))}
              </fieldset>
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_9rem]">
              <select aria-label="Fee head" value={add.headId} onChange={(e) => setAdd({ ...add, headId: e.target.value })} className={INPUT}><option value="">No fee head</option>{heads.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
              <input aria-label="What the charge is" placeholder="What it is for" value={add.label} onChange={(e) => setAdd({ ...add, label: e.target.value })} className={INPUT} />
              <MoneyInput label="Charge amount" labelHidden valuePaise={add.amountPaise} onChange={(p) => setAdd({ ...add, amountPaise: p })} />
            </div>
          )}
          <ModalField label="Reason" htmlFor={`${id}-why`} required error={error || undefined}>
            <textarea id={`${id}-why`} rows={3} value={reason} onChange={(e) => { setReason(e.target.value); setError(""); }} className={`${INPUT} h-auto py-2`} />
          </ModalField>
          <p className="text-xs text-[var(--ds-on-surface-muted)]">Small notes apply at once. A larger one waits for an approver and the bill stays as it is until then. {kind === "credit" ? "You cannot take off more than is open." : ""}</p>
        </div>
      </Modal>
    </>
  );
}
