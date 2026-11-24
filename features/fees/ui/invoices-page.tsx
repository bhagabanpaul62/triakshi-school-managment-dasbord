import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { buttonVariants } from "@smw/ui/ui/button";
import type { Column, FilterDef } from "@smw/ui/shell/DataTable";
import { INVOICE_KINDS } from "../constants";
import { InvoiceService } from "../service";
import { FeesLookup } from "./lookups";
import { InvoicesTable } from "./invoices-table";
import { DateRange, NoAccess, PillLink, STATE_TABS, SectionNav, Tabs, can, one, queryOf, type Search } from "./shared";

export const metadata = { title: "Bills" };

const columns: Column[] = [
  { key: "number", label: "Number", type: "mono" }, { key: "studentName", label: "Student", type: "person", metaKey: "admissionNo" }, { key: "label", label: "For", hideOnMobile: true },
  { key: "dueDate", label: "Due", type: "date" }, { key: "state", label: "State", type: "state" }, { key: "grossPaise", label: "Billed", type: "money", hideOnMobile: true }, { key: "openPaise", label: "Open", type: "money" },
];
const KIND_LABEL: Record<(typeof INVOICE_KINDS)[number], string> = { plan: "From a plan", transport: "Transport", library_fine: "Library fine", custom: "Extra charge", opening: "Opening balance", bounce: "Bounce charge" };

export default async function InvoicesPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "read")) return <NoAccess what="Bills" who="the accounts team" />;
  const sp = await searchParams, state = one(sp.state), setup = can(ctx, "setup");
  const svc = new InvoiceService(ctx), base = listQueryFrom(sp);
  const { state: _state, ...rest } = base.filters;
  const inTab = (v: string) => ({ ...base, page: 1, pageSize: 1, filters: v ? { ...rest, state: v } : rest });
  const [page, classes, years, ...counts] = await Promise.all([
    svc.list(base), new FeesLookup(ctx).classes(), new FeesLookup(ctx).years(),
    ...STATE_TABS.map(([v]) => svc.list(inTab(v)).then((r) => r.total)),
  ]);
  const filters: FilterDef[] = [
    { key: "classId", label: "Class", options: classes.map((c) => ({ value: c.id, label: c.name })) },
    { key: "yearId", label: "Year", options: years.map((y) => ({ value: y.id, label: y.name })) },
    { key: "kind", label: "Kind", options: INVOICE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })) },
  ];
  const qs = queryOf(sp);
  const tabHref = (v: string) => { const n = new URLSearchParams(qs); n.delete("state"); if (v) n.set("state", v); return `/app/fees/invoices${n.size ? `?${n}` : ""}`; };

  return (
    <>
      <PageHeader eyebrow="Fees" title="Bills" description="Every bill from draft to paid. Open one to collect, correct or print it."
        actions={<>
          <Link href={`/app/fees/export/invoices${qs ? `?${qs}` : ""}`} prefetch={false} className={buttonVariants({ variant: "ghost", className: "rounded-full" })}>Download CSV</Link>
          {setup ? <PillLink href="/app/fees/invoices/issue">Issue from plans</PillLink> : null}
          {setup ? <PillLink href="/app/fees/invoices/new" primary>New bill</PillLink> : null}
        </>} />
      <SectionNav ctx={ctx} current="/app/fees/invoices" />
      <Tabs label="Bill state" tabs={STATE_TABS.map(([v, l], i) => [v, l, counts[i]] as const)} current={state} href={tabHref} />
      <InvoicesTable canIssue={setup} canRemind={can(ctx, "collect")} columns={columns} filters={filters} rows={page.rows.map((r) => ({ ...r, status: r.status }))} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/app/fees/invoices/{id}"
        searchPlaceholder="Search number, student or admission number" toolbar={<DateRange sp={sp} />}
        empty={{ title: state ? "No bills in this tab" : "No bills yet", description: state ? "Try another tab, or clear the search and filters." : "Bills come from published fee plans, or you can make one for a single student.",
          action: setup ? <div className="flex gap-2"><PillLink href="/app/fees/invoices/issue" primary>Issue from plans</PillLink><PillLink href="/app/fees/invoices/new">New bill</PillLink></div> : undefined }} />
    </>
  );
}
