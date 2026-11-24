"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { splitCredit, type GstParts } from "@smw/billing/amounts";
import { inWords, rupees } from "@smw/feature-kit/money";
import { Button } from "@smw/ui/ui/button";
import { INPUT, type FormResult } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { Money } from "@smw/ui/finance/Money";
import { MoneyInput } from "@smw/ui/finance/MoneyInput";

export interface CreditNoteFormProps {
  invoiceId: string;
  invoiceNumber: string;
  /** What is left of the invoice to credit, split into its GST parts (invoice less credit notes already issued). */
  left: GstParts;
  paid: boolean;
  /** Cash that can still go back, for a paid invoice. */
  refundablePaise: number;
  action: (fd: FormData) => Promise<FormResult>;
}

const METHODS = [["bank_transfer", "Bank transfer"], ["cheque", "Cheque"], ["upi", "UPI"], ["cash", "Cash"]] as const;

/** Credit note with the GST split and what will happen to the money shown before it is issued. */
export function CreditNoteForm({ invoiceId, invoiceNumber, left, paid, refundablePaise, action }: CreditNoteFormProps) {
  const [amount, setAmount] = useState<number | null>(null);
  const [kind, setKind] = useState<"correction" | "refund" | "goodwill">("correction");
  const [settle, setSettle] = useState<"refund" | "credit">(refundablePaise > 0 ? "refund" : "credit");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();

  // What the choices mean for the money: the server applies the same rules.
  const goes = !paid ? "adjusted" : kind === "goodwill" ? "credit" : kind === "refund" ? "refund" : settle;
  const valid = amount !== null && amount >= 1 && amount <= left.totalPaise;
  const split = valid ? splitCredit(left, amount) : null;
  const outcome = {
    adjusted: "The invoice is lowered, so the school owes less. If this is all of it, the invoice is cancelled.",
    refund: "You pay this money back to the school, then record the refund here.",
    credit: "The money stays with us as credit. The school's next invoice uses it.",
  }[goes];

  const submit = (fd: FormData) => start(async () => {
    fd.set("invoiceId", invoiceId);
    fd.set("amountPaise", String(amount ?? ""));
    fd.set("kind", kind);
    if (paid && kind === "correction") fd.set("settle", settle);
    const r = await action(fd);
    if (r.ok) { toast(r.message ?? "Credit note issued"); setAmount(null); setErrors({}); router.refresh(); }
    else { setErrors({ ...(r.fieldErrors ?? {}), form: r.error }); }
  });

  return (
    <form action={submit} className="flex flex-col gap-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyInput label="Amount to credit (GST included)" valuePaise={amount} onChange={setAmount} max={left.totalPaise} required error={errors.amountPaise} hint={`Up to ${rupees(left.totalPaise)} is left on ${invoiceNumber}.`} words={inWords} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cn-kind" className="text-[13px] font-medium text-[var(--ds-on-surface-variant)]">Why</label>
          <select id="cn-kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={INPUT}>
            <option value="correction">A mistake on the invoice</option>
            <option value="refund">Money back to the school</option>
            <option value="goodwill">Goodwill</option>
          </select>
        </div>
      </div>

      {paid && kind === "correction" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 text-[13px] font-medium text-[var(--ds-on-surface-variant)]">The school has paid. Where does the money go?</legend>
          {refundablePaise > 0 ? <label className="flex items-center gap-2 text-sm"><input type="radio" name="cn-settle" checked={settle === "refund"} onChange={() => setSettle("refund")} className="accent-[var(--ds-primary)]" />Pay it back</label> : null}
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="cn-settle" checked={settle === "credit"} onChange={() => setSettle("credit")} className="accent-[var(--ds-primary)]" />Keep it as credit for the next invoice</label>
          {errors.settle ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{errors.settle}</p> : null}
        </fieldset>
      ) : errors.settle ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{errors.settle}</p> : null}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="cn-reason" className="text-[13px] font-medium text-[var(--ds-on-surface-variant)]">Reason (printed on the credit note)</label>
        <textarea id="cn-reason" name="reason" rows={2} required aria-invalid={errors.reason ? true : undefined} className={`${INPUT} h-auto py-2`} />
        {errors.reason ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{errors.reason}</p> : null}
      </div>

      {goes === "refund" && paid ? (
        <details className="rounded-2xl bg-white/[0.035] p-4">
          <summary className="cursor-pointer text-sm">Already paid it back? Add the details now</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5"><label htmlFor="cn-method" className="text-[13px] text-[var(--ds-on-surface-variant)]">Paid back by</label>
              <select id="cn-method" name="refundMethod" defaultValue="" className={INPUT}><option value="">Not paid back yet</option>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="cn-ref" className="text-[13px] text-[var(--ds-on-surface-variant)]">Reference</label><input id="cn-ref" name="refundReference" className={INPUT} /></div>
            <div className="flex flex-col gap-1.5"><label htmlFor="cn-on" className="text-[13px] text-[var(--ds-on-surface-variant)]">Paid on</label><input id="cn-on" type="date" name="refundedOn" className={INPUT} /></div>
          </div>
        </details>
      ) : null}

      <div aria-live="polite" className="rounded-2xl bg-white/[0.035] p-4">
        <p className="text-xs text-[var(--ds-on-surface-muted)]">What the credit note will show</p>
        {split ? (
          <dl className="mt-2 grid max-w-sm grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
            <dt>Taxable value</dt><dd><Money paise={split.taxablePaise} fixed /></dd>
            {split.igstPaise > 0 ? <><dt>IGST 18%</dt><dd><Money paise={split.igstPaise} fixed /></dd></> : <><dt>CGST 9%</dt><dd><Money paise={split.cgstPaise} fixed /></dd><dt>SGST 9%</dt><dd><Money paise={split.sgstPaise} fixed /></dd></>}
            <dt className="font-medium">Credit total</dt><dd className="font-medium"><Money paise={split.totalPaise} fixed /></dd>
          </dl>
        ) : <p className="mt-2 text-sm text-[var(--ds-on-surface-variant)]">Enter an amount up to what is left to see the split.</p>}
        <p className="mt-3 text-sm text-[var(--ds-on-surface-variant)]">{outcome} It gets its own number, is emailed to the school, and cannot be edited later.</p>
      </div>

      {errors.form && !errors.amountPaise && !errors.reason && !errors.settle ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{errors.form}</p> : null}
      <div><Button type="submit" className="h-10 rounded-full" isLoading={pending} disabled={!valid}>Issue credit note</Button></div>
    </form>
  );
}
