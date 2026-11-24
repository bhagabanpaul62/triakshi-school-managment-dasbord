import Link from "next/link";
import { TdsService } from "@smw/billing";
import { listQueryFrom } from "@smw/feature-kit";
import { requireStaff } from "@smw/runtime/console";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { sendBackTds, verifyTds } from "../actions";
import { reasonField } from "../fields";

export const metadata = { title: "TDS certificates" };
const columns: Column[] = [
  { key: "schoolName", label: "School" },
  { key: "invoiceNumber", label: "Invoice", type: "mono", hideOnMobile: true },
  { key: "quarter", label: "Quarter" },
  { key: "amountPaise", label: "Tax withheld", type: "money" },
  { key: "remindOn", label: "Reminder day", type: "date", hideOnMobile: true },
  { key: "status", label: "Status", type: "badge", labels: { awaited: "Awaited", received: "To check", verified: "Verified" }, tones: { awaited: "warning", received: "info", verified: "success" } },
];
const TEXT_LINK = "text-[var(--ds-color-primary-400)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";

export default async function ConsoleTdsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireStaff();
  const sp = await searchParams;
  const page = await new TdsService(staff).list(listQueryFrom(sp));
  const canCheck = staff.role === "owner" || staff.role === "sales";
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && k !== "page" ? [[k, v]] : []))).toString();
  return (
    <>
      <Link href="/billing" className={`${TEXT_LINK} mb-3 inline-flex h-10 items-center text-sm`}>Back to billing</Link>
      <PageHeader eyebrow="Business" title="TDS certificates" description="Schools that paid after withholding tax owe us the certificate. Awaited ones get a reminder 45 days after the quarter ends."
        actions={<span className="flex gap-2"><Link href="/billing/tds?status=awaited" className="inline-flex h-10 items-center rounded-full bg-white/[0.07] px-4 text-sm hover:bg-white/[0.12]">Awaited only</Link>
          <a href={`/billing/export/tds${qs ? `?${qs}` : ""}`} className="inline-flex h-10 items-center rounded-full bg-white/[0.07] px-4 text-sm hover:bg-white/[0.12]">Download CSV</a></span>} />
      <div className="relative overflow-x-clip">
        <DataTable columns={columns} rows={page.rows as unknown as Record<string, unknown>[]} total={page.total} page={page.page} pageCount={page.pageCount} searchPlaceholder="Search school or invoice"
          filters={[{ key: "status", label: "Status", options: [{ value: "awaited", label: "Awaited" }, { value: "received", label: "To check" }, { value: "verified", label: "Verified" }] }]}
          empty={{ title: "No TDS certificates.", description: "One appears here when staff record a payment with tax withheld.", action: <Link href="/billing" className={TEXT_LINK}>Go to invoices</Link> }}
          rowActions={Object.fromEntries(page.rows.map((r) => [r.id, (
            <span key={r.id} className="inline-flex items-center gap-2 text-sm">
              {r.status !== "awaited" ? <a href={`/billing/tds/${r.id}/file`} className={TEXT_LINK}>View file</a> : <span className="text-xs text-[var(--ds-on-surface-muted)]">Waiting for the school</span>}
              {r.status === "received" && canCheck ? <ActionButton action={verifyTds} values={{ id: r.id }} label="Verify" variant="ghost" successMessage="Certificate verified" /> : null}
              {r.status !== "awaited" && canCheck ? <FormModal title="Send back to the school" description={`${r.schoolName}, ${r.quarter}. The file is removed and they upload again.`} icon="billing" fields={reasonField}
                hidden={{ id: r.id }} action={sendBackTds} submitLabel="Send back" trigger={{ label: "Send back", variant: "ghost", size: "sm", plus: false }} /> : null}
              <Link href={`/billing/invoices/${r.invoiceId}`} className={TEXT_LINK}>Invoice</Link>
            </span>
          )]))} />
      </div>
    </>
  );
}
