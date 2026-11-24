import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsoleBillingService } from "@smw/billing";
import { NotFoundError } from "@smw/feature-kit";
import { rupees, todayIST } from "@smw/feature-kit/money";
import { requireStaff } from "@smw/runtime/console";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { EmptyLine } from "@smw/ui/finance/States";
import { KeyTotals } from "@smw/ui/finance/KeyTotals";
import { PeriodPicker } from "@smw/ui/finance/PeriodPicker";
import { Timeline } from "@smw/ui/finance/Timeline";
import { parsePeriod, presetPeriod } from "@smw/ui/finance/logic";

export const metadata = { title: "School billing" };
const TEXT_LINK = "text-[var(--ds-color-primary-400)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";
const BTN = "inline-flex h-10 items-center rounded-full bg-white/[0.07] px-4 text-sm hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]";
const KIND = { invoice: "Invoice", payment: "Payment", tds: "Tax withheld", credit_note: "Credit note", refund: "Refund paid", credit_used: "Credit used" } as const;

export default async function SchoolBillingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const staff = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const today = todayIST();
  const fallback = presetPeriod("this_fy", today);
  const period = sp.period ? parsePeriod({ period: sp.period, from: sp.from, to: sp.to }, today) : fallback;
  const svc = new ConsoleBillingService(staff);
  const acct = await svc.schoolAccount(id, period).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const st = acct.statement;
  return (
    <>
      <Link href="/billing" className={`${TEXT_LINK} mb-3 inline-flex h-10 items-center text-sm`}>Back to billing</Link>
      <PageHeader eyebrow="School billing" title={acct.school.name} description="What this school was billed, paid and holds in credit with us."
        actions={<span className="flex flex-wrap gap-2"><Link href={`/billing?schoolId=${id}`} className={BTN}>Invoices</Link><Link href={`/billing/payments?schoolId=${id}`} className={BTN}>Payments</Link><Link href={`/billing/credit-notes?q=${encodeURIComponent(acct.school.name)}`} className={BTN}>Credit notes</Link><Link href={`/schools/${id}`} className={BTN}>School page</Link></span>} />
      <div className="flex flex-col gap-6">
        <KeyTotals items={[
          { label: "Opening balance", paise: st.openingPaise },
          { label: "Billed", paise: st.debitPaise },
          { label: "Paid or credited", paise: st.creditPaise },
          { label: st.closingPaise < 0 ? "Credit with us" : "Owes us", paise: Math.abs(st.closingPaise), strong: true, tone: st.closingPaise > 0 ? "warning" : st.closingPaise < 0 ? "success" : "default" },
          { label: "Credit for next invoice", paise: acct.creditPaise, hint: "Used automatically when the next invoice is issued" },
        ]} />
        <Panel title="Account statement" action={<PeriodPicker today={today} presets={["this_fy", "last_fy", "this_quarter"]} fallback={fallback} />}>
          <Timeline emptyText="Nothing happened in this period." items={st.rows.map((r) => ({
            at: r.at.toISOString(), title: `${KIND[r.kind]} ${r.ref}`, meta: `${r.text}. Balance ${rupees(r.balancePaise)}`,
            amountPaise: r.kind === "credit_used" ? undefined : r.amountPaise, tone: r.amountPaise < 0 ? "success" : undefined,
            href: r.invoiceId ? `/billing/invoices/${r.invoiceId}` : undefined,
          }))} />
          {st.rows.length === 0 ? <div className="mt-3"><EmptyLine title="No activity in this period." hint="Pick another period to see earlier invoices and payments." /></div> : null}
        </Panel>
      </div>
    </>
  );
}
