import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { buttonVariants } from "@smw/ui/ui/button";
import type { Column, FilterDef } from "@smw/ui/shell/DataTable";
import { Panel } from "@smw/ui/kit/Panel";
import { AgeingBar } from "@smw/ui/finance/AgeingBar";
import { KeyTotals } from "@smw/ui/finance/KeyTotals";
import { AGE_BANDS } from "../constants";
import { DuesService, HeadService } from "../service";
import { DuesTable } from "./dues-table";
import { ageingBuckets } from "./logic";
import { FeesLookup } from "./lookups";
import { NoAccess, Notice, SectionNav, Tabs, can, one, queryOf, type Search } from "./shared";

export const metadata = { title: "Students' dues" };

const columns: Column[] = [
  { key: "name", label: "Student", type: "person", metaKey: "meta" }, { key: "classLabel", label: "Class", hideOnMobile: true }, { key: "due", label: "Open", type: "money" },
  { key: "overdue", label: "Overdue", type: "money", hideOnMobile: true }, { key: "accrued", label: "Late fee building", type: "money", hideOnMobile: true }, { key: "nextDueDate", label: "Next due", type: "date", hideOnMobile: true }, { key: "status", label: "State", type: "state" },
];

export default async function DuesPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "read")) return <NoAccess what="Dues" who="the accounts team" />;
  const sp = await searchParams, overdue = one(sp.overdue) === "1", lookup = new FeesLookup(ctx);
  const [data, classes, heads, routes] = await Promise.all([new DuesService(ctx).report(listQueryFrom(sp)), lookup.classes(), new HeadService(ctx).options(), lookup.routes()]);
  const filters: FilterDef[] = [
    { key: "classId", label: "Class", options: classes.map((c) => ({ value: c.id, label: c.name })) },
    { key: "headId", label: "Fee", options: heads.map((h) => ({ value: h.id, label: h.name })) },
    ...(routes.length ? [{ key: "routeId", label: "Route", options: routes.map((r) => ({ value: r.id, label: r.name })) }] : []),
    { key: "age", label: "How late", options: AGE_BANDS.map((b) => ({ value: b.key, label: b.label })) },
    { key: "status", label: "Student", options: [{ value: "active", label: "At school" }, { value: "left", label: "Left" }, { value: "alumni", label: "Alumni" }] },
  ];
  const age = AGE_BANDS.find((b) => b.key === one(sp.age));
  const cols = age ? [...columns.slice(0, 3), { key: "inBand", label: age.label, type: "money" as const }, ...columns.slice(3)] : columns;
  const qs = queryOf(sp);
  const tabHref = (v: string) => { const n = new URLSearchParams(qs); n.delete("overdue"); n.delete("age"); if (v) n.set("overdue", v); return `/app/fees/dues${n.size ? `?${n}` : ""}`; };
  const rows = data.rows.map((r) => ({ ...r, meta: `${r.admissionNo}${r.studentStatus !== "active" ? ` · ${r.studentStatus === "left" ? "Left" : "Alumni"}${r.leftOn ? ` ${r.leftOn}` : ""}` : ""}` }));

  return (
    <>
      <PageHeader eyebrow="Fees" title="Students' dues" description="Who owes what, worst first. Students who left stay on the list until they pay."
        actions={<><Link href={`/app/fees/export/dues${qs ? `?${qs}` : ""}`} prefetch={false} className={buttonVariants({ variant: "ghost", className: "rounded-full" })}>Download CSV</Link><Link href={`/app/fees/export/dues${qs ? `?${qs}&` : "?"}format=pdf`} prefetch={false} target="_blank" className={buttonVariants({ variant: "ghost", className: "rounded-full" })}>Print</Link></>} />
      <SectionNav ctx={ctx} current="/app/fees/dues" />
      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Panel title="What is open"><KeyTotals items={[{ label: "Open in all", paise: data.totals.due, strong: true }, { label: "Overdue", paise: data.totals.overdue, tone: data.totals.overdue ? "danger" : undefined }]} /></Panel>
        <Panel title="By how late"><AgeingBar buckets={ageingBuckets(data.totals.ageing)} label="Open amount by how late it is" /></Panel>
      </div>
      {age ? <Notice tone="info" action={{ href: tabHref(overdue ? "1" : ""), label: "Show every age" }}>Showing students with something open that is {age.label.toLowerCase()}. The download has the same list.</Notice> : null}
      <Tabs label="Dues" tabs={[["", "Everyone with dues"], ["1", "Overdue only"]]} current={overdue ? "1" : ""} href={tabHref} />
      <DuesTable canRemind={can(ctx, "collect")} columns={cols} filters={filters} rows={rows} total={data.total} page={data.page} pageCount={data.pageCount} rowHref="/app/fees/students/{id}" searchPlaceholder="Search name or admission number"
        empty={{ title: overdue ? "Nobody is overdue" : "Nobody owes anything", description: "Students with a bill that is open appear here. Issue the bills from the fee plans if none have been made yet.", action: <Link href="/app/fees/invoices" className={buttonVariants({ className: "rounded-full" })}>Open bills</Link> }} />
    </>
  );
}
