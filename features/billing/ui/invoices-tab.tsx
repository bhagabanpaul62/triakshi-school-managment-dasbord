import type { BillingService } from "@smw/billing";
import { dueOf, invoiceStateOf } from "@smw/billing/amounts";
import { listQueryFrom } from "@smw/feature-kit";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { CheckoutButton } from "./checkout-button";
import { payInvoice } from "./actions";

const columns: Column[] = [
  { key: "number", label: "Invoice", type: "mono" },
  { key: "description", label: "For", hideOnMobile: true },
  { key: "createdAt", label: "Issued", type: "date" },
  { key: "totalPaise", label: "Total (incl. GST)", type: "money", hideOnMobile: true },
  { key: "duePaise", label: "Due now", type: "money" },
  { key: "state", label: "Status", type: "state" },
];
const LINK = "inline-flex h-10 items-center rounded-full px-4 text-sm text-[var(--ds-color-primary-400)] hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";

export async function InvoicesTab({ svc, params, canManage }: { svc: BillingService; params: Record<string, string | string[] | undefined>; canManage: boolean }) {
  const page = await svc.listInvoices(listQueryFrom(params));
  const now = new Date();
  const rows = page.rows.map((r) => ({ ...r, state: invoiceStateOf(r, now), duePaise: r.status === "issued" ? dueOf(r) : null }));
  return (
    <DataTable columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount}
      filters={[{ key: "status", label: "Status", options: [{ value: "issued", label: "Due" }, { value: "paid", label: "Paid" }, { value: "void", label: "Cancelled" }] }]}
      searchable={false}
      empty={{ title: "No invoices yet.", description: "Your first invoice appears when you pick a plan.", action: canManage ? <a href="#plans" className={LINK}>Choose a plan</a> : undefined }}
      rowActions={Object.fromEntries(rows.map((r) => [r.id, (
        <span key={r.id} className="inline-flex items-center gap-1">
          {canManage && r.status === "issued" ? <CheckoutButton action={payInvoice} values={{ id: r.id }} label="Pay now" /> : null}
          <a href={`/app/billing/invoices/${r.id}/pdf`} className={LINK} aria-label={`Download ${r.status === "paid" ? "receipt" : "invoice"} ${r.number} as PDF`} title="Download PDF">{r.status === "paid" ? "Receipt" : "PDF"}</a>
        </span>
      )]))} />
  );
}
