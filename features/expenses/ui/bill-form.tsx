"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { Button } from "@smw/ui/ui/button";
import { INPUT } from "@smw/ui/shell/FormModal";
import { toast } from "@smw/ui/shell/toast";
import { MoneyInput } from "@smw/ui/finance/MoneyInput";
import { Money } from "@smw/ui/finance/Money";
import { addDays } from "@smw/feature-kit/money";
import { RecordPicker, type PickerOption } from "@smw/ui/finance/RecordPicker";
import { previewBill, saveBill, findVendors } from "./actions";

interface Choice { id: string; name: string }
interface Line { key: string; accountId: string; costCentreId: string; vehicleId: string; label: string; amountPaise: number | null }
export interface BillFormProps {
  accounts: (Choice & { code: string })[]; centres: Choice[]; vehicles: Choice[]; today: string;
  vendor?: PickerOption;
  bill?: { id: string; billNo: string; billDate: string; dueDate: string; note: string | null; fileName: string | null; lines: { accountId: string; costCentreId: string | null; vehicleId: string | null; label: string; amountPaise: number }[] };
  defaultAccountId?: string;
}
type Preview = { grossPaise: number; tdsPaise: number; netPaise: number; basis: string; postings: { side: string; label: string; paise: number }[]; warnings: string[]; blocks: string[]; needsApproval: boolean; limitPaise: number };

const key = () => Math.random().toString(36).slice(2);
const field = "flex flex-col gap-1.5 text-sm";

/** One column: vendor, dates, lines, then what the bill will do before it is saved. */
export function BillForm({ accounts, centres, vehicles, today, vendor, bill, defaultAccountId }: BillFormProps) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [vendorId, setVendorId] = useState(vendor?.id ?? "");
  const [billDate, setBillDate] = useState(bill?.billDate ?? today);
  const [tds, setTds] = useState("");
  const [lines, setLines] = useState<Line[]>(bill?.lines.map((l) => ({ key: key(), accountId: l.accountId, costCentreId: l.costCentreId ?? "", vehicleId: l.vehicleId ?? "", label: l.label, amountPaise: l.amountPaise })) ?? [{ key: key(), accountId: defaultAccountId ?? "", costCentreId: "", vehicleId: "", label: "", amountPaise: null }]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const set = (k: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const usable = lines.filter((l) => l.accountId && l.amountPaise);

  useEffect(() => {
    if (!vendorId || !usable.length) { setPreview(null); return; }
    const t = setTimeout(async () => {
      const r = await previewBill(JSON.stringify({ vendorId, billDate, tdsBasisPoints: tds ? Math.round(Number(tds) * 100) : undefined, id: bill?.id, lines: usable.map((l) => ({ accountId: l.accountId, costCentreId: l.costCentreId || null, label: l.label || "Line", amountPaise: l.amountPaise })) }));
      setPreview(r.ok ? r.data : null);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId, billDate, tds, JSON.stringify(usable.map((l) => [l.accountId, l.costCentreId, l.amountPaise]))]);

  const send = (submit: boolean) => start(async () => {
    setError(""); setErrors({});
    const fd = new FormData(form.current!);
    fd.set("lines", JSON.stringify(lines.map((l) => ({ accountId: l.accountId, costCentreId: l.costCentreId || null, vehicleId: l.vehicleId || null, label: l.label, amountPaise: l.amountPaise ?? 0 }))));
    if (bill) fd.set("id", bill.id);
    if (tds) fd.set("tdsBasisPoints", String(Math.round(Number(tds) * 100))); else fd.delete("tdsBasisPoints");
    if (submit) fd.set("submit", "1");
    const r = await saveBill(fd);
    if (!r.ok) { setError(r.error); setErrors(r.fieldErrors ?? {}); return; }
    toast(r.data.outcome === "draft" ? "Draft saved" : r.data.outcome === "approved" ? "Approved and posted" : "Sent for approval");
    router.push(`/app/expenses/bills?bill=${r.data.id}`);
  });

  return (
    <form ref={form} onSubmit={(e) => { e.preventDefault(); send(false); }} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex flex-col gap-5 rounded-3xl bg-[var(--ds-surface-container-low)] p-4 sm:p-6">
        <RecordPicker action={findVendors} name="vendorId" label="Vendor" required initial={vendor ? [vendor] : []} error={errors.vendorId} onChange={(p) => setVendorId(p[0]?.id ?? "")} placeholder="Search vendors, press / to jump here" />
        <p className="-mt-3 text-xs text-[var(--ds-on-surface-muted)]">Not in the list? <Link href={`/app/expenses/vendors?next=${encodeURIComponent("/app/expenses/bills/new")}`} className="underline underline-offset-4">Add the vendor first</Link>. You will come back here.</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className={field}>Bill number<input name="billNo" defaultValue={bill?.billNo} required className={INPUT} aria-invalid={errors.billNo ? true : undefined} />{errors.billNo ? <span className="text-xs text-[var(--ds-color-danger-400)]">{errors.billNo}</span> : null}</label>
          <label className={field}>Bill date<input type="date" name="billDate" value={billDate} max={today} onChange={(e) => setBillDate(e.target.value)} required className={INPUT} /></label>
          <label className={field}>Due date<input type="date" name="dueDate" defaultValue={bill?.dueDate ?? addDays(today, 30)} required className={INPUT} aria-invalid={errors.dueDate ? true : undefined} />{errors.dueDate ? <span className="text-xs text-[var(--ds-color-danger-400)]">{errors.dueDate}</span> : null}</label>
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">What the bill is for</legend>
          {lines.map((l, i) => (
            <div key={l.key} className="grid gap-2 rounded-2xl bg-white/[0.03] p-3 sm:grid-cols-[1.2fr_1fr_9rem_auto]">
              <label className={field}><span className="sr-only">Line {i + 1} account</span>
                <select value={l.accountId} onChange={(e) => set(l.key, { accountId: e.target.value })} className={INPUT} aria-label={`Line ${i + 1} account`}>
                  <option value="">Choose account</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                </select></label>
              <input value={l.label} onChange={(e) => set(l.key, { label: e.target.value })} placeholder="Describe the line" aria-label={`Line ${i + 1} description`} className={INPUT} />
              <MoneyInput label={`Line ${i + 1} amount`} labelHidden valuePaise={l.amountPaise} onChange={(p) => set(l.key, { amountPaise: p })} />
              <button type="button" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--ds-on-surface-muted)] hover:bg-white/[0.06] disabled:opacity-30"><IconTrash className="h-4 w-4" aria-hidden /></button>
              {centres.length || vehicles.length ? (
                <div className="flex flex-wrap gap-2 sm:col-span-4">
                  {centres.length ? <select value={l.costCentreId} onChange={(e) => set(l.key, { costCentreId: e.target.value })} aria-label={`Line ${i + 1} cost centre`} className={`${INPUT} sm:max-w-56`}><option value="">No cost centre</option>{centres.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : null}
                  {vehicles.length ? <select value={l.vehicleId} onChange={(e) => set(l.key, { vehicleId: e.target.value })} aria-label={`Line ${i + 1} vehicle`} className={`${INPUT} sm:max-w-56`}><option value="">No vehicle</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select> : null}
                </div>
              ) : null}
            </div>
          ))}
          {errors.lines ? <p role="alert" className="text-xs text-[var(--ds-color-danger-400)]">{errors.lines}</p> : null}
          <Button type="button" variant="ghost" className="self-start rounded-full" onClick={() => setLines((ls) => [...ls, { key: key(), accountId: ls.at(-1)?.accountId ?? "", costCentreId: "", vehicleId: "", label: "", amountPaise: null }])}><IconPlus className="mr-1 h-4 w-4" aria-hidden />Add a line</Button>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className={field}>Tax withheld, % (blank = the vendor's usual)<input value={tds} onChange={(e) => setTds(e.target.value)} inputMode="decimal" placeholder="Vendor default" className={INPUT} /></label>
          <label className={field}>Photo or PDF of the bill<input type="file" name="file" accept="application/pdf,image/jpeg,image/png" className={INPUT} />
            <span className="text-xs text-[var(--ds-on-surface-muted)]">{bill?.fileName ? `Now: ${bill.fileName}. Choose another to replace it. ` : ""}PDF, JPG or PNG, up to 10 MB.</span>{errors.file ? <span className="text-xs text-[var(--ds-color-danger-400)]">{errors.file}</span> : null}</label>
        </div>
        <label className={field}>Note<textarea name="note" defaultValue={bill?.note ?? ""} rows={2} className={`${INPUT} h-auto py-2`} /></label>
      </div>

      <aside aria-label="What this bill will do" className="flex h-fit flex-col gap-4 rounded-3xl bg-[var(--ds-surface-container-low)] p-4 sm:p-6 lg:sticky lg:top-4">
        <h2 className="text-sm font-medium">What happens when you save</h2>
        {preview ? <>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-[var(--ds-on-surface-muted)]">Bill total</dt><dd className="text-right"><Money paise={preview.grossPaise} /></dd>
            <dt className="text-[var(--ds-on-surface-muted)]">Tax withheld</dt><dd className="text-right"><Money paise={preview.tdsPaise} /></dd>
            <dt className="font-medium">You will pay</dt><dd className="text-right font-medium"><Money paise={preview.netPaise} /></dd>
          </dl>
          {preview.basis === "cash" ? <p className="text-xs text-[var(--ds-on-surface-muted)]">This school books expenses when paid, so nothing is posted until a payment.</p> : (
            <table className="w-full text-xs"><caption className="mb-1 text-left text-[var(--ds-on-surface-muted)]">Entry in the books once approved</caption><tbody>
              {preview.postings.map((p, i) => <tr key={i} className="border-t border-white/[0.06]"><td className="w-8 py-1">{p.side}</td><td className="py-1">{p.label}</td><td className="py-1 text-right"><Money paise={p.paise} /></td></tr>)}
            </tbody></table>
          )}
          {preview.warnings.map((w) => <p key={w} className="text-xs text-[var(--ds-color-warning-400)]">Budget: {w}</p>)}
          {preview.blocks.map((w) => <p key={w} className="text-xs text-[var(--ds-color-danger-400)]">{w} An approver must say yes.</p>)}
          <p className="text-xs text-[var(--ds-on-surface-variant)]">{preview.needsApproval ? "This needs an approver before it counts." : "Under the limit and inside budget, so it is approved at once."}</p>
        </> : <p className="text-sm text-[var(--ds-on-surface-muted)]">Choose a vendor and fill the amounts. The totals, the entry and any budget effect show here.</p>}
        {error ? <p role="alert" className="text-sm text-[var(--ds-color-danger-400)]">{error}</p> : null}
        <div className="flex flex-col gap-2">
          <Button type="button" className="rounded-full" isLoading={pending} onClick={() => send(true)}>Save and send for approval</Button>
          <Button type="submit" variant="secondary" className="rounded-full" disabled={pending}>Save as draft</Button>
          <Link href={bill ? `/app/expenses/bills?bill=${bill.id}` : "/app/expenses/bills"} className="py-2 text-center text-sm text-[var(--ds-on-surface-muted)] underline underline-offset-4">Cancel</Link>
        </div>
      </aside>
    </form>
  );
}
