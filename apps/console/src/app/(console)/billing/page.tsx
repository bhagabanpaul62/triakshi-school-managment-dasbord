import Link from "next/link";
import { ConsoleBillingService } from "@smw/billing";
import { listQueryFrom } from "@smw/feature-kit";
import { requireStaff } from "@smw/runtime/console";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { PageHeader, KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { paise } from "@smw/ui/format";
import { AgeingBar } from "@smw/ui/finance/AgeingBar";
import { recordOfflinePayment } from "./actions";
import { offlineFields } from "./fields";
import { RevenueChart } from "./revenue-chart";

export const metadata = { title: "Billing" };

const columns: Column[] = [
  { key: "number", label: "Invoice", type: "mono" },
  { key: "schoolName", label: "School" },
  { key: "description", label: "For", hideOnMobile: true },
  { key: "totalPaise", label: "Total", type: "money", hideOnMobile: true },
  { key: "duePaise", label: "Due now", type: "money" },
  { key: "dueAt", label: "Due date", type: "date", hideOnMobile: true },
  { key: "status", label: "Status", type: "badge", labels: { issued: "Due", paid: "Paid", overdue: "Overdue", void: "Cancelled" }, tones: { paid: "success", issued: "warning", overdue: "danger" } },
];

export default async function ConsoleBillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireStaff();
  const svc = new ConsoleBillingService(staff);
  const sp = await searchParams;
  const [page, revenue, ageing] = await Promise.all([svc.invoices(listQueryFrom(sp)), svc.revenue(), svc.ageing()]);
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && k !== "page" ? [[k, v]] : []))).toString();
  const canRecord = staff.role === "owner" || staff.role === "sales";

  return (
    <>
      <PageHeader eyebrow="Business" title="Billing" description={`Invoices across every school. Financial year ${revenue.financialYear}.`}
        actions={<span className="flex flex-wrap gap-2">
          {[["/billing/payments", "Payments"], ["/billing/credit-notes", "Credit notes"], ["/billing/credit-notes?refund=due", "Refunds to pay"], ["/billing/tds", "TDS certificates"], [`/billing/export/invoices${qs ? `?${qs}` : ""}`, "Download CSV"]].map(([href, label]) => (
            <Link key={label} href={href!} prefetch={false} className="inline-flex h-10 items-center rounded-full bg-white/[0.07] px-4 text-sm hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]">{label}</Link>))}
        </span>} />
      <KpiRow>
        <StatCard label="Collected this year" value={paise(revenue.collectedPaise)} meta={`FY ${revenue.financialYear}, GST included`} />
        <StatCard label="Outstanding" value={paise(revenue.outstandingPaise)} meta="issued, not yet paid" />
        <StatCard label="Overdue" value={paise(revenue.overduePaise)} meta={`${revenue.overdueCount} invoice${revenue.overdueCount === 1 ? "" : "s"} past due date`} />
        <StatCard label="Invoices" value={page.total.toLocaleString("en-IN")} meta="matching the filters below" />
      </KpiRow>
      <PanelGrid>
        <div className="lg:col-span-12">
          <Panel title="Who owes us, by how late">
            <AgeingBar buckets={ageing.map((b) => ({ label: `${b.label} (${b.count})`, paise: b.paise, href: `/billing?age=${b.key}` }))} label="Receivables by age" />
          </Panel>
        </div>
        <div className="lg:col-span-12">
          <Panel title="Collected by month">
            <RevenueChart data={revenue.months.map((m) => ({ month: m.month, rupees: m.paise / 100 }))} />
          </Panel>
        </div>
      </PanelGrid>
      <div className="relative mt-8 overflow-x-clip"> {/* clip: the table's sr-only "Actions" header would widen the phone page */}
        <DataTable columns={columns} rows={page.rows as unknown as Record<string, unknown>[]} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/billing/invoices/{id}"
          searchPlaceholder="Search invoice or school"
          filters={[{ key: "status", label: "Status", options: [{ value: "issued", label: "Due" }, { value: "overdue", label: "Overdue" }, { value: "paid", label: "Paid" }] }]}
          empty={{ title: "No invoices match.", description: "Invoices appear when a school picks a plan. Clear the filters to see them all.", action: <Link href="/billing" className="text-[var(--ds-color-primary-400)] hover:underline">Clear filters</Link> }}
          rowActions={canRecord ? Object.fromEntries(page.rows.filter((r) => r.status === "issued" || r.status === "overdue").map((r) => [r.id, (
            <FormModal key={r.id} title={`Record payment for ${r.number}`} description={`${r.schoolName}. Marks the invoice paid and activates the plan.`} icon="billing"
              fields={offlineFields} values={{ amountPaise: r.duePaise, method: "bank_transfer" }} hidden={{ invoiceId: r.id }}
              action={recordOfflinePayment} submitLabel="Record payment" trigger={{ label: "Record payment", variant: "ghost", size: "sm" }} />
          )])) : undefined} />
      </div>
    </>
  );
}
