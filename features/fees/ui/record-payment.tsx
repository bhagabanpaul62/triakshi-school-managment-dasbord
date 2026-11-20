"use client";

import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal, ModalField, ModalFooter } from "@smw/ui/kit/Modal";
import { IconChip } from "@smw/ui/kit/Panel";
import { SegmentedControl } from "@smw/ui/kit/SegmentedControl";
import { Button } from "@smw/ui/ui/button";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { MenuIconView } from "@smw/ui/shell/icons";
import { toast } from "@smw/ui/shell/toast";
import { FeeCalculator, rupees, type CalcInput } from "../calculator";
import { METHOD_OPTIONS } from "./fields";

function Chip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="inline-flex h-9 items-center rounded-full bg-white/[0.06] px-3 text-xs tabular-nums hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">{children}</button>;
}

const toPaise = (rupeesText: string) => Math.round(Number(rupeesText) * 100) || 0;

/**
 * Record a payment. The same FeeCalculator the server uses shows, as you type, exactly where the money will go,
 * so the cashier sees "Allocates ₹13,250 to Term 1 (₹250 late fee)" before saving.
 */
export function RecordPaymentModal({ studentId, studentName, calc, today, action, autoOpen }: {
  autoOpen?: boolean; studentId: string; studentName: string; calc: CalcInput; today: string; action: (fd: FormData) => Promise<FormResult>;
}) {
  const uid = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [done, setDone] = useState<{ id: string; receiptNo: string; amount: number } | null>(null);

  const calculator = useMemo(() => new FeeCalculator(calc), [calc]);
  const when = paidOn || today;
  const plan = useMemo(() => calculator.allocate(toPaise(amount), when), [calculator, amount, when]);
  const owed = useMemo(() => new FeeCalculator({ ...calc, today: when }).statement(), [calc, when]);
  const next = owed.lines.find((l) => l.due > 0);

  // Arriving from the counter search (?pay=1) opens the form with the next installment already filled in.
  useEffect(() => {
    if (autoOpen && next) { setAmount(String(next.due / 100)); setOpen(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  const submit = () => start(async () => {
    const fd = new FormData();
    fd.set("studentId", studentId);
    fd.set("amountPaise", String(toPaise(amount)));
    fd.set("method", method);
    fd.set("reference", reference);
    fd.set("paidOn", paidOn);
    const r = await action(fd);
    if (r.ok) {
      const d = r.data as { id?: string; receiptNo?: string } | undefined;
      toast(d?.receiptNo ? `Payment recorded. Receipt ${d.receiptNo}` : "Payment recorded");
      if (d?.id && d.receiptNo) setDone({ id: d.id, receiptNo: d.receiptNo, amount: toPaise(amount) }); else setOpen(false);
      setAmount(""); setReference(""); setErrors({});
      router.refresh();
    } else {
      setErrors(r.fieldErrors ?? {});
      toast(r.error, "danger");
    }
  });

  const summary = !toPaise(amount) ? "Enter an amount to see where it goes."
    : plan.unallocated > 0 ? `${rupees(plan.unallocated)} more than the ${rupees(plan.allocated)} due.`
    : `Allocates ${plan.allocations.map((a) => `${rupees(a.amountPaise + a.lateFeePaise)} to ${a.name}${a.lateFeePaise ? ` (${rupees(a.lateFeePaise)} late fee)` : ""}`).join(", ")}`;
  const blocked = !toPaise(amount) || plan.unallocated > 0 || !plan.allocations.length;

  return (
    <>
      <Button className="rounded-full" onClick={() => { setErrors({}); setDone(null); setMethod("cash"); setAmount(next ? String(next.due / 100) : ""); setPaidOn(today); setOpen(true); }} disabled={!owed.totals.due}>
        Record payment
      </Button>
      <Modal open={open} onOpenChange={setOpen} size="md" title={done ? "Payment recorded" : "Record payment"} description={done ? `From ${studentName}` : `From ${studentName}`} dismissOnOutsideClick={false}
        icon={<IconChip className="h-10 w-10"><MenuIconView name="money" /></IconChip>}
        footer={done ? <ModalFooter summary={<span>{rupees(done.amount)} received. Receipt {done.receiptNo}</span>}
          secondary={{ label: "Done", onClick: () => setOpen(false) }} primary={{ label: "Print receipt", onClick: () => { window.open(`/app/fees/receipts/${done.id}`, "_blank", "noopener"); } }} />
          : <ModalFooter summary={<span className={plan.unallocated > 0 ? "text-[var(--ds-color-danger-400)]" : undefined}>{summary}</span>}
          secondary={{ onClick: () => setOpen(false) }} primary={{ label: "Save and number receipt", onClick: submit, loading: pending, disabled: blocked }} />}>
        {done ? (
          <div className="flex flex-col gap-2 pt-2">
            <p className="text-[34px] font-medium tabular-nums tracking-tight">{rupees(done.amount)}</p>
            <p className="text-sm text-[var(--ds-on-surface-variant)]">Receipt <span className="font-mono">{done.receiptNo}</span> is numbered and saved. Print it for the family, or close this and keep going.</p>
          </div>
        ) : (
        <form className="grid gap-4 pt-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (!blocked) submit(); }} noValidate>
          <ModalField label="Amount (₹)" htmlFor={`${uid}-amount`} required error={errors.amountPaise}
            className="sm:col-span-2">
            <input id={`${uid}-amount`} type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={INPUT} aria-invalid={!!errors.amountPaise || undefined} autoFocus />
            <div className="mt-2 flex flex-wrap gap-2">
              {next ? <Chip onClick={() => setAmount(String(next.due / 100))}>{next.name} {rupees(next.due)}</Chip> : null}
              {owed.totals.due !== next?.due ? <Chip onClick={() => setAmount(String(owed.totals.due / 100))}>All dues {rupees(owed.totals.due)}</Chip> : null}
            </div>
          </ModalField>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-[var(--ds-on-surface-variant)]">Paid by</span>
            <SegmentedControl label="Payment method" value={method} onChange={(v) => { setMethod(v); setReference(""); }} options={METHOD_OPTIONS} />
          </div>
          <ModalField label="Paid on" htmlFor={`${uid}-paidOn`} required error={errors.paidOn} className="sm:col-span-2">
            <input id={`${uid}-paidOn`} type="date" max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className={INPUT} aria-invalid={!!errors.paidOn || undefined} />
          </ModalField>
          {method !== "cash" ? (
            <ModalField label={method === "cheque" ? "Cheque number" : method === "upi" ? "UPI reference" : "Bank reference"} htmlFor={`${uid}-ref`} required error={errors.reference} className="sm:col-span-2">
              <input id={`${uid}-ref`} value={reference} onChange={(e) => setReference(e.target.value)} className={INPUT} aria-invalid={!!errors.reference || undefined} />
            </ModalField>
          ) : null}
          <p className="text-sm text-[var(--ds-on-surface-variant)] sm:hidden sm:col-span-2">{summary}</p>
        </form>
        )}
      </Modal>
    </>
  );
}
