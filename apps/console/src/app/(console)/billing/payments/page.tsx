import Link from "next/link";
import { ConsoleBillingService } from "@smw/billing";
import { listQueryFrom } from "@smw/feature-kit";
import { requireStaff } from "@smw/runtime/console";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { PageHeader } from "@smw/ui/shell/PageHeader";

export const metadata = { title: "Payments" };
const columns: Column[] = [
  { key: "paidAt", label: "Paid on", type: "date" },
  { key: "schoolName", label: "School" },
  { key: "invoiceNumber", label: "Invoice", type: "mono" },
  { key: "amountPaise", label: "Cash received", type: "money" },
  { key: "tdsPaise", label: "Tax withheld", type: "money", hideOnMobile: true },
  { key: "method", label: "Method", type: "badge", labels: { cashfree: "Online", bank_transfer: "Bank transfer", cheque: "Cheque", cash: "Cash", upi: "UPI" }, hideOnMobile: true },
  { key: "reference", label: "Reference", type: "mono", hideOnMobile: true },
];
const TEXT_LINK = "text-[var(--ds-color-primary-400)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";

export default async function ConsolePaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const page = await new ConsoleBillingService(staff).payments(listQueryFrom(sp));
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && k !== "page" ? [[k, v]] : []))).toString();
  const rows = page.rows.map((r) => ({ ...r, tdsPaise: r.tdsPaise || null }));
  return (
    <>
      <Link href="/billing" className={`${TEXT_LINK} mb-3 inline-flex h-10 items-center text-sm`}>Back to billing</Link>
      <PageHeader eyebrow="Business" title="Payments" description="Every payment that reached us, from every school."
        actions={<a href={`/billing/export/payments${qs ? `?${qs}` : ""}`} className="inline-flex h-10 items-center rounded-full bg-white/[0.07] px-4 text-sm hover:bg-white/[0.12]">Download CSV</a>} />
      <div className="relative overflow-x-clip">
        <DataTable columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} searchPlaceholder="Search school, invoice or reference"
          empty={{ title: "No payments yet.", description: "Payments appear here when a school pays online or staff record one.", action: <Link href="/billing" className={TEXT_LINK}>Go to invoices</Link> }}
          rowActions={Object.fromEntries(rows.map((r) => [r.id, <span key={r.id} className="inline-flex gap-3 text-sm">{r.invoiceId ? <Link href={`/billing/invoices/${r.invoiceId}`} className={TEXT_LINK}>Invoice</Link> : null}<Link href={`/billing/schools/${r.schoolId}`} className={TEXT_LINK}>School</Link></span>]))} />
      </div>
    </>
  );
}
