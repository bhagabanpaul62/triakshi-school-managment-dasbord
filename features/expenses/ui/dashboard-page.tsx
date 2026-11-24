import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader, PanelGrid } from "@smw/ui/shell/PageHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { BigStat } from "@smw/ui/kit/BigStat";
import { TrendArea } from "@smw/ui/kit/TrendArea";
import { HatchedBars } from "@smw/ui/kit/HatchedBars";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { buttonVariants } from "@smw/ui/ui/button";
import { AgeingBar } from "@smw/ui/finance/AgeingBar";
import { VarianceBar } from "@smw/ui/finance/VarianceBar";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { Money } from "@smw/ui/finance/Money";
import { paise, shortDate, tilePaise } from "@smw/ui/format";
import { ExpenseReportService } from "../service";
import { NoAccess, SectionNav, can } from "./shared";

export const metadata = { title: "Expenses" };

export default async function ExpensesDashboard() {
  const ctx = await requireCtx();
  if (!can(ctx, "read")) return <NoAccess ctx={ctx} what="Expenses" who="accountants and admins" />;
  const d = await new ExpenseReportService(ctx).dashboard();
  const canManage = can(ctx, "manage");
  const delta = d.lastMonthPaise ? Math.round(((d.spentPaise - d.lastMonthPaise) / d.lastMonthPaise) * 100) : null;
  const empty = !d.spentPaise && !d.upcoming.length && !d.byAccount.length;

  return (
    <>
      <PageHeader eyebrow="Finance" title="Expenses" description={`Spending for ${d.fy}: what went out, what is owed and what is coming up.`}
        actions={canManage ? <>
          <Link href="/app/expenses/payments/new" className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Pay a vendor</Link>
          <Link href="/app/expenses/bills/new" className={buttonVariants({ className: "rounded-full" })}>New bill</Link>
        </> : null} />
      <SectionNav ctx={ctx} current="/app/expenses" />
      {empty ? (
        <div className="rounded-3xl bg-[var(--ds-surface-container-low)] p-8">
          <WidgetEmptyState title="No spending yet" description="Add a vendor, enter the first bill and it shows up here with what is owed and what is due." />
          {canManage ? <div className="mt-4 flex justify-center gap-2"><Link href="/app/expenses/vendors" className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Add a vendor</Link><Link href="/app/expenses/bills/new" className={buttonVariants({ className: "rounded-full" })}>Enter a bill</Link></div> : null}
        </div>
      ) : (
        <PanelGrid>
          <Panel title="Spent this month" className="lg:col-span-7">
            <BigStat label="Out the door since the 1st" value={tilePaise(d.spentPaise)} size="lg"
              delta={delta === null ? undefined : `${delta > 0 ? "+" : ""}${delta}% on last month`} tone={delta !== null && delta > 15 ? "warning" : "default"}
              hint={d.hasBudgets ? `Budget for the month: ${paise(d.budgetMonthPaise)}` : <Link href="/app/expenses/budgets" className="underline underline-offset-4">Set a budget</Link>} />
            <div className="mt-6">
              <TrendArea data={d.monthly.map((m) => ({ month: m.month, spend: m.paise / 100 }))} xKey="month" series={[{ key: "spend", label: "Spend", accent: true }]} height={200} format={(v) => paise(v * 100)} />
            </div>
          </Panel>
          <Panel title="Owed to vendors" action={<Link href="/app/expenses/bills?status=unpaid" className="text-sm underline underline-offset-4">All unpaid bills</Link>} className="lg:col-span-5">
            <AgeingBar buckets={d.ageing} label="Unpaid bills by how late they are" />
          </Panel>
          <Panel title="Pay in the next 30 days" className="lg:col-span-7">
            {d.upcoming.length ? (
              <ul className="divide-y divide-white/[0.06]">
                {d.upcoming.slice(0, 8).map((u) => (
                  <li key={u.id}>
                    <Link href={`/app/expenses/bills?bill=${u.id}`} className="flex min-h-12 items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
                      <span className="min-w-0"><span className="block truncate">{u.vendorName}</span><span className="block text-xs text-[var(--ds-on-surface-muted)]">{u.billNo} · due {shortDate(u.dueDate)}</span></span>
                      <span className="flex items-center gap-3"><StateBadge state={u.state} /><Money paise={u.openPaise} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <WidgetEmptyState title="Nothing to pay soon" description="Approved bills that fall due in the next 30 days show here." />}
          </Panel>
          <Panel title="Where it went this year" className="lg:col-span-5">
            {d.byAccount.length ? <HatchedBars items={d.byAccount.map((a) => ({ key: a.key, label: a.label, value: a.paise / 100, display: tilePaise(a.paise) }))} /> : <WidgetEmptyState title="No spending posted" description="Bills count once approved." />}
          </Panel>
          <Panel title="Budgets to watch" action={<Link href="/app/expenses/budgets" className="text-sm underline underline-offset-4">All budgets</Link>} className="lg:col-span-12">
            {d.watch.length ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{d.watch.map((w) => <VarianceBar key={w.id} label={w.label} actual={w.actualPaise} budget={w.budgetPaise} />)}</div>
            ) : <WidgetEmptyState title={d.hasBudgets ? "Every budget is under 60% used" : "No budgets yet"} description={d.hasBudgets ? "Budgets that near their limit appear here." : "Set one for rent or electricity and get a warning before you overspend."} />}
          </Panel>
        </PanelGrid>
      )}
    </>
  );
}
