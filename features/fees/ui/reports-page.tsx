import Link from "next/link";
import { todayIST } from "@smw/feature-kit/money";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { PeriodPicker } from "@smw/ui/finance/PeriodPicker";
import { ReportTable, type ReportColumn } from "@smw/ui/finance/ReportTable";
import { KIND_LABEL, REPORT_KINDS, periodReport, type ReportKind } from "./export-route";
import { NoAccess, SectionNav, Tabs, can, one, queryOf, type Search } from "./shared";
import { CARD, MUTED, PILL } from "./styles";


export const metadata = { title: "Fee reports" };

/** Money collected and the registers behind it, for a period. The screen, the CSV and the printout read the same rows. */
export default async function ReportsPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "read")) return <NoAccess what="Fee reports" who="the accounts team" />;
  const sp = await searchParams, by = ((REPORT_KINDS as readonly string[]).includes(one(sp.by)) ? one(sp.by) : "head") as ReportKind;
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const report = await periodReport(ctx, by, flat);
  const qs = queryOf(sp, ["page"]);
  const columns: ReportColumn[] = report.columns.map((c) => ({ key: c.key, label: c.label, type: c.kind === "money" ? "money" : c.key === "receipts" ? "number" : "text" }));
  const rows = report.rows.filter((r) => r.style !== "total").map((r) => r.cells);
  // A daily report is grouped by month so the totals mean something; the others are one group.
  const groups = by === "day" ? [...new Map(rows.map((r) => [String(r.label).slice(0, 7), String(r.label).slice(0, 7)])).keys()].map((m) => ({ label: m, rows: rows.filter((r) => String(r.label).startsWith(m)) })) : [{ label: report.title, rows }];
  const tabHref = (v: string) => { const n = new URLSearchParams(qs); n.set("by", v); return `/app/fees/reports?${n}`; };
  const file = (format: string) => `/app/fees/export/${by}?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(qs)), ...(format ? { format } : {}) })}`;

  return (
    <>
      <PageHeader eyebrow="Fees" title="Fee reports" description="Money collected by fee, class, method, cashier or day, and the registers of concessions, refunds and reversals."
        actions={<><Link href={file("")} prefetch={false} className={PILL}>Download CSV</Link><Link href={file("pdf")} prefetch={false} target="_blank" className={PILL}>Print</Link></>} />
      <SectionNav ctx={ctx} current="/app/fees/reports" />
      <Tabs label="Report" current={by} href={tabHref} tabs={REPORT_KINDS.map((k) => [k, KIND_LABEL[k]] as const)} />
      {by !== "concessions" ? <div className="mb-4"><PeriodPicker today={todayIST()} /></div> : null}
      <section className={CARD}>
        <h2 className="mb-1 text-sm font-medium">{report.title}</h2><p className={`${MUTED} mb-4`}>{report.subtitle}</p>
        <ReportTable columns={columns} groups={groups} caption={report.title} totalLabel="Total" emptyText="Nothing in this period." />
      </section>
    </>
  );
}
