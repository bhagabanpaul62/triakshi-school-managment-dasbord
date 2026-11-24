import Link from "next/link";
import { CreditNoteService } from "@smw/billing";
import { listQueryFrom } from "@smw/feature-kit";
import { requireStaff } from "@smw/runtime/console";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { recordRefund, resendCreditNote } from "../actions";
import { refundFields } from "../fields";

export const metadata = { title: "Credit notes and refunds" };
const columns: Column[] = [
  { key: "number", label: "Credit note", type: "mono" },
  { key: "createdAt", label: "Date", type: "date" },
  { key: "schoolName", label: "School" },
  { key: "invoiceNumber", label: "Invoice", type: "mono", hideOnMobile: true },
  { key: "kind", label: "Why", type: "badge", labels: { correction: "Mistake", refund: "Refund", goodwill: "Goodwill" }, hideOnMobile: true },
  { key: "totalPaise", label: "Amount", type: "money" },
  { key: "settled", label: "Settled", type: "badge", labels: { adjusted: "Taken off invoice", credit: "Kept as credit", refund_due: "Refund to pay", refunded: "Refunded" }, tones: { credit: "info", refund_due: "warning", refunded: "success" } },
  { key: "refundReference", label: "Refund reference", type: "mono", hideOnMobile: true },
];
const TEXT_LINK = "text-[var(--ds-color-primary-400)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";

export default async function ConsoleCreditNotesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const page = await new CreditNoteService(staff).list(listQueryFrom(sp));
  const canRefund = staff.role === "owner";
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && k !== "page" ? [[k, v]] : []))).toString();
  const rows = page.rows.map((r) => ({ ...r, settled: r.settlement === "refund" ? (r.refundedAt ? "refunded" : "refund_due") : r.settlement }));
  return (
    <>
      <Link href="/billing" className={`${TEXT_LINK} mb-3 inline-flex h-10 items-center text-sm`}>Back to billing</Link>
      <PageHeader eyebrow="Business" title="Credit notes and refunds" description="Every credit note we issued. Refunds are paid back by hand, then written down here."
        actions={<a href={`/billing/export/credit-notes${qs ? `?${qs}` : ""}`} className="inline-flex h-10 items-center rounded-full bg-white/[0.07] px-4 text-sm hover:bg-white/[0.12]">Download CSV</a>} />
      <div className="relative overflow-x-clip">
        <DataTable columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} searchPlaceholder="Search credit note, invoice or school"
          filters={[
            { key: "refund", label: "Refunds", options: [{ value: "due", label: "To pay back" }, { value: "paid", label: "Paid back" }] },
            { key: "settlement", label: "Settled as", options: [{ value: "adjusted", label: "Taken off invoice" }, { value: "credit", label: "Kept as credit" }, { value: "refund", label: "Refund" }] },
          ]}
          empty={{ title: "No credit notes match.", description: "Issue one from an invoice when a bill needs correcting.", action: <Link href="/billing" className={TEXT_LINK}>Go to invoices</Link> }}
          rowActions={Object.fromEntries(rows.map((r) => [r.id, (
            <span key={r.id} className="inline-flex items-center gap-2 text-sm">
              {r.settled === "refund_due" && canRefund ? <FormModal title={`Record refund for ${r.number}`} description={`${r.schoolName}. Pay the money back first, then write down how.`} icon="billing" fields={refundFields}
                hidden={{ creditNoteId: r.id }} action={recordRefund} submitLabel="Record refund" trigger={{ label: "Record refund", variant: "ghost", size: "sm" }} /> : null}
              {r.settled === "refund_due" && !canRefund ? <span className="text-xs text-[var(--ds-on-surface-muted)]">The owner records the refund</span> : null}
              <a href={`/billing/credit-notes/${r.id}/pdf`} className={TEXT_LINK}>PDF</a>
              <Link href={`/billing/invoices/${r.invoiceId}`} className={TEXT_LINK}>Invoice</Link>
              {staff.role === "owner" || staff.role === "support" ? <FormModal title={`Email ${r.number} again`} description={`Sends the PDF to ${r.schoolName} again.`} icon="billing" fields={[]} hidden={{ id: r.id }} action={resendCreditNote} submitLabel="Send again" trigger={{ label: "Email again", variant: "ghost", size: "sm", plus: false }} /> : null}
            </span>
          )]))} />
      </div>
    </>
  );
}
