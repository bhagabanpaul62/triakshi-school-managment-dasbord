import Link from "next/link";
import { notFound } from "next/navigation";
import { ConsoleBillingService, creditableOf, dueOf, invoiceStateOf, refundableOf } from "@smw/billing";
import { NotFoundError } from "@smw/feature-kit";
import { rupees } from "@smw/feature-kit/money";
import { requireStaff } from "@smw/runtime/console";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ConfirmMoney } from "@smw/ui/finance/ConfirmMoney";
import { KeyTotals } from "@smw/ui/finance/KeyTotals";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { StatusTrack } from "@smw/ui/finance/StatusTrack";
import { Timeline, type TimelineItem } from "@smw/ui/finance/Timeline";
import { EmptyLine } from "@smw/ui/finance/States";
import { Money } from "@smw/ui/finance/Money";
import { cancelInvoice, issueCreditNote, recordOfflinePayment } from "../../actions";
import { CreditNoteForm } from "../../credit-note-form";
import { offlineFields } from "../../fields";

export const metadata = { title: "Invoice" };
const LINK = "inline-flex h-10 items-center rounded-full bg-white/[0.07] px-4 text-sm hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]";
const TEXT_LINK = "text-[var(--ds-color-primary-400)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";

export default async function ConsoleInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  const d = await new ConsoleBillingService(staff).invoice(id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const { invoice: inv, school } = d;
  const canIssue = staff.role === "owner" || staff.role === "support";
  const canRecord = staff.role === "owner" || staff.role === "sales";
  const state = invoiceStateOf(inv);
  const creditable = creditableOf(inv);
  const left = {
    taxablePaise: inv.taxablePaise - d.creditNotes.reduce((n, c) => n + c.taxablePaise, 0), cgstPaise: inv.cgstPaise - d.creditNotes.reduce((n, c) => n + c.cgstPaise, 0),
    sgstPaise: inv.sgstPaise - d.creditNotes.reduce((n, c) => n + c.sgstPaise, 0), igstPaise: inv.igstPaise - d.creditNotes.reduce((n, c) => n + c.igstPaise, 0), totalPaise: creditable,
  };

  const events: TimelineItem[] = [
    { at: inv.createdAt.toISOString(), title: `Invoice ${inv.number} issued`, amountPaise: inv.totalPaise },
    ...d.payments.map((p) => ({ at: (p.paidAt ?? p.createdAt).toISOString(), title: `Payment (${p.method.replace("_", " ")})${p.reference ? `, ${p.reference}` : ""}`, amountPaise: p.amountPaise, tone: "success" as const, meta: p.tdsPaise ? `Plus ${rupees(p.tdsPaise)} tax withheld` : undefined })),
    ...d.creditNotes.map((c) => ({ at: c.createdAt.toISOString(), title: `Credit note ${c.number}`, meta: c.reason, amountPaise: c.totalPaise, href: `/billing/credit-notes/${c.id}/pdf` })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <>
      <Link href="/billing" className={`${TEXT_LINK} mb-3 inline-flex h-10 items-center text-sm`}>Back to billing</Link>
      <PageHeader eyebrow="Invoice" title={inv.number} description={`${school.name}. ${inv.description}`}
        actions={<span className="flex flex-wrap items-center gap-2"><StateBadge state={state} /><a href={`/billing/invoices/${inv.id}/pdf`} className={LINK}>Invoice PDF</a><Link href={`/billing/schools/${school.id}`} className={LINK}>School account</Link></span>} />
      <div className="flex flex-col gap-6">
        <StatusTrack label="Invoice progress" steps={[
          { label: "Issued", state: "done", at: inv.createdAt.toISOString().slice(0, 10) },
          inv.status === "void" ? { label: "Cancelled", state: "failed" } : { label: "Paid", state: inv.status === "paid" ? "done" : "now", at: inv.paidAt?.toISOString().slice(0, 10) },
        ]} />
        <KeyTotals items={[
          { label: "Invoice total", paise: inv.totalPaise },
          { label: "Credit notes", paise: inv.creditedPaise },
          { label: "Account credit used", paise: inv.creditAppliedPaise },
          { label: "Tax withheld (TDS)", paise: inv.tdsPaise },
          { label: "Due now", paise: dueOf(inv), strong: true, tone: dueOf(inv) > 0 ? (state === "overdue" ? "danger" : "warning") : "default" },
        ]} />

        <Panel title="Next step">
          <div className="flex flex-wrap items-center gap-3">
            {inv.status === "issued" && canRecord ? <FormModal title={`Record payment for ${inv.number}`} description={`${school.name}. Marks the invoice paid and activates the plan.`} icon="billing" fields={offlineFields}
              values={{ amountPaise: dueOf(inv), method: "bank_transfer" }} hidden={{ invoiceId: inv.id }} action={recordOfflinePayment} submitLabel="Record payment" trigger={{ label: "Record payment", plus: false }} /> : null}
            {inv.status === "issued" && canIssue ? <ConfirmMoney action={cancelInvoice} values={{ invoiceId: inv.id }} label="Cancel invoice" amountPaise={creditable} danger confirmLabel="Cancel invoice"
              consequence="Issues a credit note for all of it and marks the invoice cancelled. If the school pays it later, the money becomes credit." /> : null}
            {inv.status === "paid" ? <p className="text-sm text-[var(--ds-on-surface-variant)]">Paid. To correct it, issue a credit note below: a paid invoice is never edited or cancelled.</p> : null}
            {inv.status === "void" ? <p className="text-sm text-[var(--ds-on-surface-variant)]">Cancelled by credit note. Nothing more to do here. <Link href={`/billing?q=${encodeURIComponent(school.name)}`} className={TEXT_LINK}>See the school&apos;s other invoices</Link>.</p> : null}
            {inv.status === "issued" && !canRecord && !canIssue ? <p className="text-sm text-[var(--ds-on-surface-variant)]">Waiting for payment. Ask an owner or sales to record it.</p> : null}
          </div>
        </Panel>

        {creditable > 0 && canIssue ? (
          <Panel title="Issue a credit note">
            <CreditNoteForm invoiceId={inv.id} invoiceNumber={inv.number} left={left} paid={inv.status === "paid"} refundablePaise={Math.max(0, refundableOf(inv))} action={issueCreditNote} />
          </Panel>
        ) : creditable > 0 ? <p className="text-sm text-[var(--ds-on-surface-muted)]">Only an owner or support can issue credit notes.</p> : null}

        <Panel title="History">
          <Timeline items={events} />
        </Panel>

        <Panel title="Credit notes and tax certificates">
          {d.creditNotes.length === 0 && d.certificates.length === 0 ? <EmptyLine title="No credit notes or TDS certificates on this invoice." /> : (
            <ul className="flex flex-col gap-2 text-sm">
              {d.creditNotes.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/[0.035] p-3">
                  <span className="font-mono text-xs">{c.number}</span><span className="min-w-0 flex-1 truncate">{c.reason}</span><Money paise={c.totalPaise} />
                  <StateBadge state={c.settlement === "refund" ? (c.refundedAt ? "paid" : "pending") : "approved"} />
                  <a href={`/billing/credit-notes/${c.id}/pdf`} className={TEXT_LINK}>PDF</a>
                  {c.settlement === "refund" && !c.refundedAt ? <Link href={`/billing/credit-notes?refund=due&q=${encodeURIComponent(c.number)}`} className={TEXT_LINK}>Record refund</Link> : null}
                </li>
              ))}
              {d.certificates.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/[0.035] p-3">
                  <span>TDS certificate {c.quarter}</span><span className="flex-1" /><Money paise={c.amountPaise} /><StateBadge state={c.status === "verified" ? "verified" : c.status === "received" ? "submitted" : "pending"} />
                  <Link href={`/billing/tds?q=${encodeURIComponent(inv.number)}`} className={TEXT_LINK}>Open in queue</Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
