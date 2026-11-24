"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { Money } from "@smw/ui/finance/Money";
import { MoneyInput } from "@smw/ui/finance/MoneyInput";
import { OUT_METHODS } from "../constants";
import { payBills, previewPayment } from "./actions";

interface Open { id: string; billNo: string; dueDate: string; openPaise: number }
export interface PaymentFormProps { vendor: { id: string; name: string; hasBank: boolean }; open: Open[]; chosen: string[]; cashAccounts: { id: string; name: string; kind: string }[]; today: string }

/** Which bills, how much of each, from where: with the total and warnings shown before paying. */
export function PaymentForm({ vendor, open, chosen, cashAccounts, today }: PaymentFormProps) {
  const router = useRouter();
  const [amounts, setAmounts] = useState<Record<string, number | null>>(Object.fromEntries(open.filter((b) => !chosen.length || chosen.includes(b.id)).map((b) => [b.id, b.openPaise])));
  const [method, setMethod] = useState<(typeof OUT_METHODS)[number]>(vendor.hasBank ? "bank_transfer" : "upi");
  const [cash, setCash] = useState(""), [date, setDate] = useState(today), [reference, setReference] = useState("");
  const [preview, setPreview] = useState<{ totalPaise: number; from: string; warnings: string[] } | null>(null);
  const [error, setError] = useState(""), [fields, setFields] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const allocations = Object.entries(amounts).filter(([, v]) => v).map(([billId, amountPaise]) => ({ billId, amountPaise }));
  const total = allocations.reduce((s, a) => s + (a.amountPaise ?? 0), 0);
  const sameKind = cashAccounts.filter((a) => (method === "cash" ? a.kind === "cash" : a.kind === "bank"));
  const bankMissing = method === "bank_transfer" && !vendor.hasBank;

  useEffect(() => {
    if (!allocations.length) { setPreview(null); return; }
    const t = setTimeout(async () => {
      const r = await previewPayment(JSON.stringify({ vendorId: vendor.id, method, date, cashAccountId: cash || undefined, allocations }));
      setPreview(r.ok ? r.data : null);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [method, cash, date, JSON.stringify(allocations)]);

  const submit = () => start(async () => {
    setError(""); setFields({});
    const fd = new FormData();
    fd.set("vendorId", vendor.id); fd.set("method", method); fd.set("date", date); fd.set("reference", reference);
    if (cash) fd.set("cashAccountId", cash);
    fd.set("allocations", JSON.stringify(allocations));
    const r = await payBills(fd);
    if (!r.ok) { setError(r.error); setFields(r.fieldErrors ?? {}); return; }
    toast(r.message ?? "Paid");
    router.push(`/app/expenses/payments?q=${encodeURIComponent(r.data.payment.number)}`);
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex flex-col gap-5 rounded-3xl bg-[var(--ds-surface-container-low)] p-4 sm:p-6">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Bills to pay, oldest due first</legend>
          {open.map((b) => (
            <div key={b.id} className="grid items-center gap-2 rounded-2xl bg-white/[0.03] p-3 sm:grid-cols-[auto_1fr_10rem]">
              <input type="checkbox" aria-label={`Pay bill ${b.billNo}`} checked={b.id in amounts} className="h-5 w-5 accent-[var(--ds-primary)]" onChange={(e) => setAmounts((a) => { const n = { ...a }; if (e.target.checked) n[b.id] = b.openPaise; else delete n[b.id]; return n; })} />
              <Link href={`/app/expenses/bills?bill=${b.id}`} className="min-w-0 text-sm"><span className="block">{b.billNo}</span><span className="block text-xs text-[var(--ds-on-surface-muted)]">due {b.dueDate} · owes <Money paise={b.openPaise} /></span></Link>
              {b.id in amounts ? <MoneyInput label={`Amount for ${b.billNo}`} labelHidden valuePaise={amounts[b.id]} max={b.openPaise} onChange={(p) => setAmounts((a) => ({ ...a, [b.id]: p }))} /> : <span className="text-xs text-[var(--ds-on-surface-muted)]">Not in this payment</span>}
            </div>
          ))}
          {fields.allocations ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{fields.allocations}</p> : null}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">How
            <select value={method} onChange={(e) => { setMethod(e.target.value as typeof method); setCash(""); }} className={INPUT}>{OUT_METHODS.map((m) => <option key={m} value={m}>{m.replace(/_/g, " ")}</option>)}</select></label>
          <label className="flex flex-col gap-1.5 text-sm">From
            <select value={cash} onChange={(e) => setCash(e.target.value)} className={INPUT}><option value="">{method === "cash" ? "Cash box (default)" : "Main bank account (default)"}</option>{sameKind.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <label className="flex flex-col gap-1.5 text-sm">Date<input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className={INPUT} aria-invalid={fields.date ? true : undefined} />{fields.date ? <span className="text-xs text-[var(--ds-color-danger-400)]">{fields.date}</span> : null}</label>
          <label className="flex flex-col gap-1.5 text-sm">{method === "cash" ? "Note" : "Reference (UTR, cheque no)"}<input value={reference} onChange={(e) => setReference(e.target.value)} className={INPUT} aria-invalid={fields.reference ? true : undefined} />{fields.reference ? <span className="text-xs text-[var(--ds-color-danger-400)]">{fields.reference}</span> : null}</label>
        </div>
        {bankMissing ? <p role="status" className="text-sm text-[var(--ds-color-warning-400)]">{vendor.name} has no bank account saved. <Link className="underline underline-offset-4" href={`/app/expenses/vendors/${vendor.id}?next=${encodeURIComponent(`/app/expenses/payments/new?vendor=${vendor.id}`)}`}>Add bank details</Link>, or choose UPI, cash or cheque.</p> : null}
      </div>
      <aside aria-label="Payment summary" className="flex h-fit flex-col gap-4 rounded-3xl bg-[var(--ds-surface-container-low)] p-4 sm:p-6 lg:sticky lg:top-4">
        <h2 className="text-sm font-medium">Paying {vendor.name}</h2>
        <Money paise={total} size="xl" />
        {preview ? <p className="text-sm text-[var(--ds-on-surface-variant)]">Goes out of {preview.from}. Dr Vendor dues or the expense, Cr {preview.from}.</p> : null}
        {preview?.warnings.map((w) => <p key={w} className="text-xs text-[var(--ds-color-warning-400)]">{w}</p>)}
        <p className="text-xs text-[var(--ds-on-surface-muted)]">A voucher number is given when you pay. A payment is never edited; a mistake is reversed with an approver's help.</p>
        {error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
        <Button type="button" className="rounded-full" isLoading={pending} disabled={!total} onClick={submit}>{total ? "Pay now" : "Choose a bill to pay"}</Button>
        <Link href="/app/expenses/payments" className="py-2 text-center text-sm text-[var(--ds-on-surface-muted)] underline underline-offset-4">Cancel</Link>
      </aside>
    </div>
  );
}
