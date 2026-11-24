import type { BillingService } from "@smw/billing";
import { listQueryFrom } from "@smw/feature-kit";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { Panel } from "@smw/ui/kit/Panel";
import { Money } from "@smw/ui/finance/Money";
import { EmptyLine } from "@smw/ui/finance/States";

const noteColumns: Column[] = [
  { key: "number", label: "Credit note", type: "mono" },
  { key: "invoiceNumber", label: "Invoice", type: "mono", hideOnMobile: true },
  { key: "createdAt", label: "Date", type: "date" },
  { key: "reason", label: "Reason", hideOnMobile: true },
  { key: "totalPaise", label: "Amount", type: "money" },
  { key: "settled", label: "Settled", type: "badge", labels: { adjusted: "Taken off invoice", credit: "Kept as credit", refund_due: "Refund on its way", refunded: "Refunded" }, tones: { adjusted: "default", credit: "info", refund_due: "warning", refunded: "success" } },
];
const creditColumns: Column[] = [
  { key: "at", label: "Date", type: "date" },
  { key: "kind", label: "What", type: "badge", labels: { second_payment: "Second payment", overpayment: "Overpayment", voided_payment: "Cancelled invoice paid", credit_note: "Credit note", used: "Used on invoice", released: "Returned" }, tones: { used: "default" } },
  { key: "invoiceNumber", label: "Invoice", type: "mono" },
  { key: "amountPaise", label: "Amount", type: "money" },
];
const LINK = "inline-flex h-10 items-center rounded-full px-4 text-sm text-[var(--ds-color-primary-400)] hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";

export async function CreditsTab({ svc, params }: { svc: BillingService; params: Record<string, string | string[] | undefined> }) {
  const [notes, credits] = await Promise.all([svc.listCreditNotes(listQueryFrom(params)), svc.credits()]);
  const noteRows = notes.rows.map((n) => ({ ...n, settled: n.settlement === "refund" ? (n.refundedAt ? "refunded" : "refund_due") : n.settlement }));
  return (
    <div className="flex flex-col gap-6">
      <Panel title="Account credit">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Money paise={credits.balancePaise} size="xl" tone={credits.balancePaise > 0 ? "success" : "default"} />
            <p className="mt-2 max-w-[56ch] text-sm text-[var(--ds-on-surface-variant)]">
              {credits.balancePaise > 0 ? "We use this automatically on your next invoice, so you pay less or nothing." : "You have no credit with us. Money from a second payment or a goodwill credit note shows up here."}
            </p>
          </div>
        </div>
        {credits.rows.length ? (
          <div className="mt-5">
            <DataTable columns={creditColumns} rows={credits.rows} total={credits.rows.length} page={1} pageCount={1} searchable={false} empty={{ title: "No credit yet.", description: "" }} />
          </div>
        ) : null}
      </Panel>
      <div>
        <h2 className="pb-3 text-[15px] font-medium">Credit notes</h2>
        {notes.total === 0 ? <EmptyLine title="No credit notes." hint="If we correct or cancel an invoice, the credit note shows up here and in your email." /> : (
          <DataTable columns={noteColumns} rows={noteRows} total={notes.total} page={notes.page} pageCount={notes.pageCount} searchable={false} empty={{ title: "No credit notes.", description: "" }}
            rowActions={Object.fromEntries(noteRows.map((n) => [n.id, <a key={n.id} href={`/app/billing/credit-notes/${n.id}/pdf`} className={LINK} aria-label={`Download credit note ${n.number} as PDF`}>PDF</a>]))} />
        )}
      </div>
    </div>
  );
}
