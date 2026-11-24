import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { addMonths, monthStart, todayIST } from "@smw/feature-kit/money";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { buttonVariants } from "@smw/ui/ui/button";
import { Panel } from "@smw/ui/kit/Panel";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { KeyTotals } from "@smw/ui/finance/KeyTotals";
import { Sparkline } from "@smw/ui/finance/Sparkline";
import { Money } from "@smw/ui/finance/Money";
import { shortDate } from "@smw/ui/format";
import { BillService, LookupService, VendorService } from "../service";
import { saveVendor, setVendorActive } from "./actions";
import { vendorFields, vendorValues } from "./vendor-fields";
import { VendorReveal } from "./vendor-reveal";
import { BackLink, NoAccess, Notice, can, one, safeNext, type Search } from "./shared";

export const metadata = { title: "Vendor" };

export default async function VendorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "read")) return <NoAccess ctx={ctx} what="Vendors" who="accountants and admins" />;
  const { id } = await params, sp = await searchParams, manage = can(ctx, "manage"), next = safeNext(one(sp.next));
  const from = one(sp.from) || monthStart(addMonths(todayIST(), -11)), to = one(sp.to) || todayIST();
  const [st, accounts, open] = await Promise.all([new VendorService(ctx).statement(id, { from, to }), new LookupService(ctx).accounts(), new BillService(ctx).openFor(id).catch(() => [])]);
  const v = st.vendor, billed = st.rows.reduce((s, r) => s + r.creditPaise, 0), paid = st.rows.reduce((s, r) => s + r.debitPaise, 0);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(monthStart(todayIST()), i - 11).slice(0, 7));
  const trend = months.map((m) => st.rows.filter((r) => r.kind === "bill" && r.date.startsWith(m)).reduce((s, r) => s + r.creditPaise, 0));

  return (
    <>
      <BackLink href={next ?? "/app/expenses/vendors"}>{next ? "Back" : "Vendors"}</BackLink>
      <PageHeader eyebrow="Vendor" title={v.name} description={[v.phone, v.email, v.isActive ? null : "Switched off"].filter(Boolean).join(" · ") || undefined}
        actions={manage ? <>
          <FormModal title={`Edit ${v.name}`} icon="users" size="lg" fields={vendorFields(accounts, v)} values={vendorValues(v)} action={saveVendor} submitLabel="Save" trigger={{ label: "Edit", variant: "secondary", plus: false }} redirectTo={next} />
          <Link href={`/app/expenses/bills/new?vendor=${v.id}`} className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>New bill</Link>
          {open.length ? <Link href={`/app/expenses/payments/new?vendor=${v.id}`} className={buttonVariants({ className: "rounded-full" })}>Pay</Link> : null}
        </> : null} />
      {!v.hasBank && manage ? <Notice action={undefined}>No bank or UPI details yet. Use Edit to add them before paying by bank transfer.</Notice> : null}
      <KeyTotals items={[{ label: "Billed in this period", paise: billed }, { label: "Paid", paise: paid, tone: "success" }, { label: "Owed now", paise: st.closingPaise, tone: st.closingPaise ? "warning" : "default" }]} />
      <div className="mt-6 grid gap-3 lg:grid-cols-12">
        <Panel title="Details" className="lg:col-span-4">
          <FactList>
            <Fact label="GSTIN">{v.gstin ?? "-"}</Fact><Fact label="PAN">{v.panLast4 ? `ends ${v.panLast4}` : "-"}</Fact><Fact label="Bank account">{v.bankLast4 ? `ends ${v.bankLast4}` : "-"}</Fact>
            <Fact label="IFSC">{v.ifsc ?? "-"}</Fact><Fact label="UPI">{v.upiId ?? "-"}</Fact><Fact label="Tax withheld">{v.tdsBasisPoints ? `${v.tdsBasisPoints / 100}%` : "None"}</Fact>
          </FactList>
          {manage && (v.panLast4 || v.bankLast4) ? <div className="mt-3"><VendorReveal id={v.id} /></div> : null}
          {manage ? <div className="mt-3"><ActionButton label={v.isActive ? "Switch off" : "Switch on"} variant="ghost" action={setVendorActive} values={{ id: v.id, active: v.isActive ? "0" : "1" }} confirm={v.isActive ? { title: `Switch off ${v.name}?`, body: "They leave the vendor picker. Old bills and payments stay.", confirmLabel: "Switch off" } : undefined} /></div> : null}
        </Panel>
        <Panel title="Billed each month" className="lg:col-span-8"><Sparkline points={trend.map((p) => p / 100)} width={560} height={72} label={`Billed per month for ${v.name}`} /><p className="mt-2 text-xs text-[var(--ds-on-surface-muted)]">Last 12 months, before tax withheld.</p></Panel>
      </div>
      <section className="mt-6 rounded-3xl bg-[var(--ds-surface-container-low)] p-4 sm:p-6" aria-label="Statement">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-base font-medium">Statement</h2>
          <form className="flex flex-wrap items-end gap-2 text-sm" method="get">
            <label className="flex flex-col gap-1">From<input type="date" name="from" defaultValue={from} className="h-10 rounded-xl bg-white/[0.05] px-3" /></label>
            <label className="flex flex-col gap-1">To<input type="date" name="to" defaultValue={to} className="h-10 rounded-xl bg-white/[0.05] px-3" /></label>
            <button className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Show</button>
          </form>
        </div>
        {st.rows.length ? (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-[var(--ds-on-surface-muted)]"><th className="py-2 font-normal">Date</th><th className="py-2 font-normal">Document</th><th className="py-2 text-right font-normal">Billed</th><th className="py-2 text-right font-normal">Paid</th><th className="py-2 text-right font-normal">Balance</th></tr></thead>
            <tbody>
              <tr className="border-t border-white/[0.06] text-[var(--ds-on-surface-muted)]"><td className="py-2" colSpan={4}>Owed before {shortDate(from)}</td><td className="py-2 text-right"><Money paise={st.openingPaise} /></td></tr>
              {st.rows.map((r) => (
                <tr key={`${r.kind}${r.id}`} className="border-t border-white/[0.06]">
                  <td className="py-2 whitespace-nowrap">{shortDate(r.date)}</td>
                  <td className="py-2"><Link className="underline underline-offset-4" href={r.kind === "bill" ? `/app/expenses/bills?bill=${r.id}` : `/app/expenses/payments?q=${encodeURIComponent(r.ref)}`}>{r.kind === "bill" ? `Bill ${r.ref}` : `Voucher ${r.ref}`}</Link></td>
                  <td className="py-2 text-right">{r.creditPaise ? <Money paise={r.creditPaise} /> : "-"}</td><td className="py-2 text-right">{r.debitPaise ? <Money paise={r.debitPaise} /> : "-"}</td><td className="py-2 text-right"><Money paise={r.balancePaise} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        ) : <p className="py-6 text-center text-sm text-[var(--ds-on-surface-muted)]">No approved bills or payments in this period. {manage ? <Link className="underline underline-offset-4" href={`/app/expenses/bills/new?vendor=${v.id}`}>Enter a bill</Link> : null}</p>}
      </section>
    </>
  );
}
