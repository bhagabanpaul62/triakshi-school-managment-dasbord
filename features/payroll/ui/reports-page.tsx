import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { todayIST } from "@smw/feature-kit/money";
import { EmptyLine } from "@smw/ui/finance/States";
import { PeriodPicker } from "@smw/ui/finance/PeriodPicker";
import { ReportTable } from "@smw/ui/finance/ReportTable";
import { parsePeriod } from "@smw/ui/finance/logic";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { cn } from "@smw/ui/utils";
import { REPORT_NAMES, ReportService, type ReportName } from "../services/reports";
import { RunService } from "../services/runs";
import { FOCUS, NoAccess, PILL_BTN, PayNav, one, type Search } from "./common";

export const metadata = { title: "Payroll reports" };
const groupRows = (rows: Record<string, unknown>[], key: string) => {
  const by = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) { const k = String(r[key] ?? "Other"); by.set(k, [...(by.get(k) ?? []), r]); }
  return [...by].map(([label, list]) => ({ label, rows: list }));
};
const BY_MONTH: ReportName[] = ["register", "pt", "tds", "esi", "components"];

export default async function ReportsPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  const svc = new ReportService(ctx);
  if (!svc.can("read")) return <NoAccess what="Payroll reports" />;
  const sp = await searchParams, today = todayIST();
  const name = (one(sp.report) as ReportName) in REPORT_NAMES ? (one(sp.report) as ReportName) : "register";
  const period = parsePeriod({ period: one(sp.period), from: one(sp.from), to: one(sp.to) }, today);
  const month = period.from.slice(0, 7), runId = one(sp.runId), by = one(sp.by) === "department" ? "department" : one(sp.by) === "cost_centre" ? "cost_centre" : "month";
  const runs = name === "bank" ? (await new RunService(ctx).list({ pageSize: 12 })).rows : [];
  const needsRun = name === "bank" && !runId;
  const report = needsRun ? null : await svc.build(name, { month, runId, by, ...(name === "components" ? { from: period.kind === "custom" || period.kind === "fy" ? period.from : undefined, to: period.kind === "custom" || period.kind === "fy" ? period.to : undefined } : {}) });
  const qs = new URLSearchParams({ name, month, ...(runId ? { runId } : {}), by });
  return (
    <>
      <PageHeader eyebrow="Payroll" title="Reports" description="Registers and files for the books, the bank and the offices. Each downloads as a file."
        actions={<>{svc.can("manage") && (name === "register" || name === "pt" || name === "tds" || name === "esi") && await svc.ecrCount(month) ? <a href={`/app/payroll/files/ecr?month=${month}`} download className={PILL_BTN}>PF return file</a> : null}</>} />
      <PayNav active="reports" manager />
      <nav aria-label="Reports" className="mb-5 flex flex-wrap gap-2">
        {(Object.keys(REPORT_NAMES) as ReportName[]).filter((k) => k !== "statement").map((k) => (
          <Link key={k} href={`/app/payroll/reports?report=${k}`} aria-current={k === name ? "page" : undefined} className={cn("rounded-full px-4 py-2 text-[13px] font-medium", FOCUS, k === name ? "bg-white/[0.12] text-[var(--ds-on-surface)]" : "bg-white/[0.05] text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface-variant)]")}>{REPORT_NAMES[k]}</Link>
        ))}
      </nav>
      {BY_MONTH.includes(name) ? <div className="mb-5"><PeriodPicker today={today} presets={["this_month", "last_month", "this_quarter", "this_fy"]} /></div> : null}
      {name === "components" ? <p className="mb-4 text-sm"><Link href={`/app/payroll/reports?report=components&by=month&period=${one(sp.period) ?? month}`} className={by === "month" ? "font-medium" : "underline"}>By month</Link> · <Link href={`/app/payroll/reports?report=components&by=department&period=${one(sp.period) ?? month}`} className={by === "department" ? "font-medium" : "underline"}>By department</Link> · <Link href={`/app/payroll/reports?report=components&by=cost_centre&period=${one(sp.period) ?? month}`} className={by === "cost_centre" ? "font-medium" : "underline"}>By cost centre</Link></p> : null}
      {needsRun ? (runs.length ? <ul className="flex flex-col gap-2">{runs.map((r) => <li key={r.id}><Link href={`/app/payroll/reports?report=bank&runId=${r.id}`} className="flex min-h-11 items-center rounded-xl bg-white/[0.04] px-4 text-sm hover:bg-white/[0.08]">{r.label}</Link></li>)}</ul> : <EmptyLine title="No pay runs yet." hint="Bank advice is made from a pay run." action={<Link href="/app/payroll/runs/new" className={PILL_BTN}>Start a run</Link>} />) : null}
      {report ? (
        <>
          <h2 className="mb-3 text-[15px] font-medium">{report.title}</h2>
          {report.note ? <p className="mb-3 text-xs text-[var(--ds-on-surface-muted)]">{report.note}</p> : null}
          <ReportTable columns={report.columns} caption={report.title} csvHref={`/app/payroll/files/report?${qs}`} emptyText="Nothing to show for this choice. Approve a pay run for the month first."
            groups={report.groupKey ? groupRows(report.rows, report.groupKey) : [{ label: "All", rows: report.rows }]} />
        </>
      ) : null}
    </>
  );
}
