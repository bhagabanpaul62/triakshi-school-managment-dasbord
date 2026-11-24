import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { BigStat } from "@smw/ui/kit/BigStat";
import { DeltaChip } from "@smw/ui/kit/DeltaChip";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { EmptyLine } from "@smw/ui/finance/States";
import { SplitBar } from "@smw/ui/finance/SplitBar";
import { StatusTrack } from "@smw/ui/finance/StatusTrack";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { Money } from "@smw/ui/finance/Money";
import { paise as rupees, shortDate } from "@smw/ui/format";
import { DashboardService } from "../services/dashboard";
import { REMIT_LABEL } from "../services/remittances";
import { CostTrend } from "./cost-trend";
import { PRIMARY_BTN, PayNav, monthName } from "./common";

export const metadata = { title: "Payroll" };

export default async function PayrollDashboardPage() {
  const ctx = await requireCtx();
  const svc = new DashboardService(ctx);
  if (!svc.can("read")) redirect("/app/payroll/me");
  const d = await svc.overview();
  const delta = d.previousNetPaise ? Math.round(((d.netPaise - d.previousNetPaise) * 100) / d.previousNetPaise) : null;
  const todo = d.setup.filter((s) => !s.done);
  return (
    <>
      <PageHeader eyebrow="Payroll" title="Payroll" description="This month's salaries, what is due to the offices and what is left to set up."
        actions={d.next ? <Link href={d.next.href} className={PRIMARY_BTN}>{d.next.text}</Link> : <Link href="/app/payroll/runs" className={PRIMARY_BTN}>All pay runs</Link>} />
      <PayNav active="overview" manager />

      {todo.length ? (
        <section aria-labelledby="setup-h" className="mb-8 rounded-3xl bg-[var(--ds-surface-container-low)] p-5">
          <h2 id="setup-h" className="text-[15px] font-medium">Set up payroll</h2>
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {todo.map((s) => <li key={s.key} className="flex flex-wrap items-center justify-between gap-2"><span>{s.text}</span><Link href={s.href} className="underline">Do it</Link></li>)}
          </ul>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Panel title={`${monthName(d.month)}`} action={d.run ? <StateBadge state={d.run.status} /> : null} className="h-full">
            <StatusTrack label="This month's pay run" steps={d.track} />
            {d.next ? <p className="mt-5 text-sm"><span className="text-[var(--ds-on-surface-muted)]">Next: </span><Link href={d.next.href} className="underline">{d.next.text}</Link></p> : <p className="mt-5 text-sm text-[var(--ds-on-surface-muted)]">Everyone is paid for this month.</p>}
          </Panel>
        </div>
        <div className="lg:col-span-4">
          <Panel title="Net pay" className="h-full">
            {d.run ? (
              <BigStat label={`${d.run.people} people, ${monthName(d.month)}`} value={rupees(d.netPaise)} size="lg"
                delta={delta === null ? undefined : <DeltaChip direction={delta >= 0 ? "up" : "down"} tone={Math.abs(delta) > 20 ? "warning" : "default"}>{Math.abs(delta)}%</DeltaChip>}
                hint={d.previousNetPaise ? `Last month ${rupees(d.previousNetPaise)}` : "No earlier month to compare"} />
            ) : <EmptyLine title="No pay run for this month yet." action={<Link href="/app/payroll/runs/new" className={PRIMARY_BTN}>Start the run</Link>} />}
          </Panel>
        </div>
        <div className="lg:col-span-8">
          <Panel title="Salary cost, 12 months" className="h-full">
            {d.trend.length ? <CostTrend months={d.trend} /> : <EmptyLine title="No approved runs yet." hint="The cost of each approved month shows here." />}
          </Panel>
        </div>
        <div className="lg:col-span-4">
          <Panel title="Due to the offices" action={<Link href="/app/payroll/statutory?tab=remittances" className="text-xs text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">All</Link>} className="h-full">
            {d.due.length === 0 ? <EmptyLine title="Nothing is due." hint="PF, ESI, professional tax and TDS show here once a run is approved." /> : (
              <ul className="flex flex-col">
                {d.due.map((r) => (
                  <li key={`${r.key}${r.month}`}>
                    <Link href="/app/payroll/statutory?tab=remittances" className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm hover:bg-white/[0.04]">
                      <span className="min-w-0"><span className="block truncate">{REMIT_LABEL[r.key]}, {monthName(r.month)}</span><span className={`block text-xs ${r.late ? "text-[var(--ds-color-danger-400)]" : "text-[var(--ds-on-surface-muted)]"}`}>{r.late ? "Late, was due" : "Due"} {shortDate(r.dueDate)}</span></span>
                      <Money paise={r.outstandingPaise} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        {d.salaryShare ? (
          <div className="lg:col-span-12">
            <Panel title="Salary against fee income, this year">
              <SplitBar label="Salaries and fee income" parts={[{ label: "Salaries and employer cost", paise: Math.max(0, d.salaryShare.salariesPaise) }, { label: "Fee income not spent on salaries", paise: Math.max(0, d.salaryShare.incomePaise - d.salaryShare.salariesPaise) }]} emptyText="No salaries or fee income posted yet." />
            </Panel>
          </div>
        ) : null}
        {d.exitsOpen ? <div className="lg:col-span-12"><p className="text-sm text-[var(--ds-on-surface-muted)]">{d.exitsOpen} final settlement{d.exitsOpen === 1 ? "" : "s"} in progress. <Link href="/app/payroll/exits" className="underline">Open exits</Link></p></div> : null}
      </div>
    </>
  );
}
