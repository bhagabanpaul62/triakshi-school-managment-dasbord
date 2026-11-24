import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { buttonVariants } from "@smw/ui/ui/button";
import type { Column } from "@smw/ui/shell/DataTable";
import { cn } from "@smw/ui/utils";
import { BillService } from "../service";
import { BillsTable } from "./bills-table";
import BillPeek from "./bill-peek";
import { NoAccess, SectionNav, can, one, type Search } from "./shared";

export const metadata = { title: "Bills" };

const columns: Column[] = [
  { key: "billNo", label: "Bill", type: "mono" }, { key: "vendorName", label: "Vendor" }, { key: "billDate", label: "Dated", type: "date", hideOnMobile: true },
  { key: "dueDate", label: "Due", type: "date" }, { key: "state", label: "State", type: "state" }, { key: "netPaise", label: "To pay", type: "money", hideOnMobile: true }, { key: "openPaise", label: "Owed", type: "money" },
];
const TABS = [["", "All"], ["draft", "Drafts"], ["pending", "Waiting"], ["unpaid", "Unpaid"], ["overdue", "Overdue"], ["paid", "Paid"], ["rejected", "Rejected"]] as const;

export default async function BillsPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "read")) return <NoAccess ctx={ctx} what="Bills" who="accountants and admins" />;
  const sp = await searchParams, status = one(sp.status), manage = can(ctx, "manage");
  const page = await new BillService(ctx).list(listQueryFrom(sp));
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && k !== "bill" && k !== "page" ? [[k, v]] : []))).toString();

  return (
    <>
      <PageHeader eyebrow="Expenses" title="Bills" description="What vendors have billed the school, from draft to paid."
        actions={<>
          <Link href={`/app/expenses/bills/csv${qs ? `?${qs}` : ""}`} prefetch={false} className={buttonVariants({ variant: "ghost", className: "rounded-full" })}>Download CSV</Link>
          {manage ? <Link href="/app/expenses/bills/new" className={buttonVariants({ className: "rounded-full" })}>New bill</Link> : null}
        </>} />
      <SectionNav ctx={ctx} current="/app/expenses/bills" />
      <div role="tablist" aria-label="Bill status" className="mb-4 flex gap-1 overflow-x-auto">
        {TABS.map(([v, label]) => (
          <Link key={v} role="tab" aria-selected={status === v} href={v ? `/app/expenses/bills?status=${v}` : "/app/expenses/bills"}
            className={cn("shrink-0 rounded-full px-4 py-2 text-sm hover:bg-white/[0.06]", status === v ? "bg-white/[0.1]" : "text-[var(--ds-on-surface-muted)]")}>{label}</Link>
        ))}
      </div>
      <BillsTable canManage={manage} columns={columns} rows={page.rows.map((r) => ({ ...r }))} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/app/expenses/bills?bill={id}"
        searchPlaceholder="Search bill number or vendor"
        empty={{ title: status ? "No bills in this tab" : "No bills yet", description: status ? "Try another tab, or clear the search." : "Enter a vendor's bill here. It is approved, paid and filed from this list.", action: manage ? <Link href="/app/expenses/bills/new" className={buttonVariants({ className: "rounded-full" })}>Enter the first bill</Link> : undefined }} />
      {one(sp.bill) ? <BillPeek ctx={ctx} id={one(sp.bill)} /> : null}
    </>
  );
}
