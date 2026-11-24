import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader, PanelGrid } from "@smw/ui/shell/PageHeader";
import { MenuIconView } from "@smw/ui/shell/icons";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { MoneyTrend } from "@smw/ui/finance/MoneyTrend";
import { HatchedBars } from "@smw/ui/kit/HatchedBars";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { AgeingBar } from "@smw/ui/finance/AgeingBar";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { paise, tilePaise } from "@smw/ui/format";
import { ChequeService, DuesService, METHOD_LABEL, PlanService, PromiseService, SetupService, SlipService } from "../service";
import FamilyHome from "./family/family-home";
import { FeesLookup } from "./lookups";
import { StudentJump } from "./student-jump";
import { SetupChecklist } from "./setup-checklist";
import { ageingBuckets } from "./logic";
import { NoAccess, PillLink, SectionNav, can } from "./shared";

export const metadata = { title: "Fees" };

/** Where each setup step is done. The setup service names a place; the fee screens added since give a better one. */
const STEP_HREF: Record<string, string> = { heads: "/app/fees/heads", plan: "/app/fees/plans/new", issue: "/app/fees/invoices/issue" };

const row = "flex min-h-12 items-center justify-between gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";

export default async function FeesDashboardPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "read")) return can(ctx, "self") ? <FamilyHome /> : <NoAccess what="Fees" who="the accounts team" />;

  const collect = can(ctx, "collect"), setup = can(ctx, "setup");
  const [d, trend, steps, broken, slips, cheques, pending, pendingPlans] = await Promise.all([
    new DuesService(ctx).overview(),
    new DuesService(ctx).trend("month", 12),
    new SetupService(ctx).status(),
    new PromiseService(ctx).broken(),
    new SlipService(ctx).list({ filters: { status: "submitted" }, pageSize: 1 }),
    collect ? Promise.all([new ChequeService(ctx).list({ filters: { status: "received" }, pageSize: 1 }), new ChequeService(ctx).list({ filters: { status: "deposited" }, pageSize: 1 })]) : null,
    new FeesLookup(ctx).pendingRequests(),
    setup ? new PlanService(ctx).list({ filters: { status: "pending" }, pageSize: 1 }) : null,
  ]);
  const s = d.summary, month = d.thisMonth, last = d.lastMonth;
  const waitingPlans = pendingPlans?.total ?? 0;
  const stepList = steps.steps.map((x) => ({ ...x, href: x.key === "plan" && waitingPlans ? "/app/finance/approvals" : STEP_HREF[x.key] ?? x.href }));
  const chequesOpen = cheques ? cheques[0].total + cheques[1].total : 0;
  const attention = [
    { key: "slips", label: "UPI payments to check", n: slips.total, href: "/app/fees/slips", show: true },
    { key: "cheques", label: "Cheques to deposit or clear", n: chequesOpen, href: "/app/fees/cheques", show: collect },
    { key: "requests", label: "Requests waiting for a decision", n: pending, href: "/app/finance/approvals", show: true },
    { key: "plans", label: "Fee plans waiting for approval", n: pendingPlans?.total ?? 0, href: "/app/fees/plans?status=pending", show: setup },
  ].filter((a) => a.show);
  const needs = attention.reduce((n, a) => n + a.n, 0) + broken.length;
  const empty = !s.billedThisYear && !s.collectedThisYear;

  return (
    <>
      <PageHeader eyebrow="Finance" title="Fees" description="What was billed, what came in and who to chase."
        actions={<>
          {collect ? <PillLink href="/app/fees/collect" primary>Collect a fee</PillLink> : null}
          {setup ? <PillLink href="/app/fees/invoices/new">New bill</PillLink> : null}
        </>} />
      <SectionNav ctx={ctx} current="/app/fees" />
      <div className="mb-6 max-w-md"><StudentJump /></div>

      {!steps.complete ? <SetupChecklist steps={stepList} next={steps.next?.key ?? null} pendingPlans={waitingPlans} /> : null}

      <PanelGrid>
        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-12 lg:grid-cols-4">
          <StatCard label="Collected this month" value={tilePaise(s.collectedThisMonth)} icon={<MenuIconView name="money" />} meta={`${s.receiptsThisMonth} receipt${s.receiptsThisMonth === 1 ? "" : "s"}. Today ${paise(s.collectedToday)}. Last month ${paise(last.collectedPaise)}`} href="/app/fees/receipts" />
          <StatCard label="Billed this month" value={tilePaise(month.billedPaise)} icon={<MenuIconView name="report" />} meta={`${month.bills} bill${month.bills === 1 ? "" : "s"} issued. Last month ${paise(last.billedPaise)}`} href="/app/fees/invoices" />
          <StatCard label="Conceded this month" value={tilePaise(month.concededPaise)} icon={<MenuIconView name="check" />} meta={`Discounts and waivers given. Last month ${paise(last.concededPaise)}`} href={can(ctx, "concede") ? "/app/fees/concessions" : "/app/fees/reports?by=concessions"} />
          <StatCard label="Outstanding" value={tilePaise(s.outstanding)} icon={<MenuIconView name="clock" />} meta={s.overdueCount ? `${paise(s.overdueAmount)} overdue, ${s.overdueCount} student${s.overdueCount === 1 ? "" : "s"}` : "Nobody is overdue"} href={s.overdueCount ? "/app/fees/dues?overdue=1" : "/app/fees/dues"} />
        </div>

        {empty ? (
          <div className="rounded-3xl bg-[var(--ds-surface-container-low)] p-8 lg:col-span-12">
            <WidgetEmptyState title="No fees billed yet" description="Make a fee plan, publish it and issue the bills. Collection, dues and the trend show here after that." />
            {setup ? <div className="mt-4 flex justify-center gap-2"><PillLink href="/app/fees/plans/new" primary>Make a fee plan</PillLink><PillLink href="/app/fees/invoices/new">Bill one student</PillLink></div> : <p className="mt-4 text-center text-sm text-[var(--ds-on-surface-muted)]">Fee plans are made by an admin or an accountant. Ask them to set up the fees.</p>}
          </div>
        ) : (
          <>
            <Panel title="Money collected" action={<Link href="/app/fees/reports" className="text-sm underline underline-offset-4">Reports</Link>} className="lg:col-span-7">
              <MoneyTrend rows={trend.map((t) => ({ label: t.label, collected: t.paise }))} series={[{ key: "collected", label: "Collected", accent: true }]} />
              <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">This year: <Money paise={s.collectedThisYear} size="sm" /> collected of <Money paise={s.billedThisYear} size="sm" /> billed.</p>
            </Panel>
            <Panel title="Outstanding by age" action={<Link href="/app/fees/dues" className="text-sm underline underline-offset-4">All dues</Link>} className="lg:col-span-5">
              <AgeingBar buckets={ageingBuckets(d.ageing)} label="Outstanding by how late it is" />
            </Panel>

            <Panel title="Who to chase" action={<Link href="/app/fees/dues?overdue=1" className="text-sm underline underline-offset-4">All overdue</Link>} className="lg:col-span-7">
              {d.chase.length ? (
                <ul className="divide-y divide-white/[0.06]">
                  {d.chase.map((r) => (
                    <li key={r.id}>
                      <Link href={`/app/fees/students/${r.id}`} className={row}>
                        <span className="min-w-0"><span className="block truncate">{r.name}</span><span className="block text-xs text-[var(--ds-on-surface-muted)]">{r.classLabel}{r.nextDueDate ? ` · next due ${r.nextDueDate}` : ""}</span></span>
                        <span className="flex items-center gap-3"><StateBadge state="overdue" /><Money paise={r.overdue} tone="danger" /></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : <WidgetEmptyState title="Nobody is overdue" description="Students past a due date appear here, biggest amount first." />}
            </Panel>
            <Panel title="Dues by class" className="lg:col-span-5">
              {d.byClass.length ? <HatchedBars items={d.byClass.map((c) => ({ key: c.classId, label: c.name.replace(/^Class\s+/i, ""), value: c.due / 100, display: tilePaise(c.due), href: `/app/fees/dues?classId=${c.classId}` }))} /> : <WidgetEmptyState title="No dues in any class" description="Classes with something open show here." />}
            </Panel>

            <Panel title="Today's receipts" action={collect ? <Link href="/app/fees/collect" className="text-sm underline underline-offset-4">Collect</Link> : undefined} className="lg:col-span-7">
              {d.today.receipts.length ? (
                <>
                  <ul className="divide-y divide-white/[0.06]">
                    {d.today.receipts.map((r) => (
                      <li key={r.id}><Link href={`/app/fees/receipts/${r.id}`} className={row}><span className="min-w-0"><span className="block truncate">{r.student}</span><span className="block text-xs text-[var(--ds-on-surface-muted)]">{r.receiptNo} · {METHOD_LABEL[r.method as keyof typeof METHOD_LABEL] ?? r.method}</span></span><Money paise={r.amountPaise} /></Link></li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">{d.today.byMethod.map((m) => `${m.label} ${paise(m.paise)}`).join(" · ")}</p>
                </>
              ) : <WidgetEmptyState title="No receipts today" description={collect ? "Receipts written today show here." : "Receipts written today show here once the cashier takes a payment."} />}
            </Panel>
            <Panel title="Needs attention" className="lg:col-span-5">
              {needs ? (
                <ul className="divide-y divide-white/[0.06]">
                  {attention.filter((a) => a.n).map((a) => (
                    <li key={a.key}><Link href={a.href} className={row}><span>{a.label}</span><span className="tabular-nums text-lg">{a.n}</span></Link></li>
                  ))}
                  {broken.slice(0, 5).map((b) => (
                    <li key={b.studentId}><Link href={`/app/fees/students/${b.studentId}`} className={row}><span className="min-w-0"><span className="block truncate">{b.name}</span><span className="block text-xs text-[var(--ds-color-danger-400)]">Promised to pay by {b.promisedOn}, still owes</span></span><span className="text-sm underline underline-offset-4">Open</span></Link></li>
                  ))}
                  {broken.length > 5 ? <li className="px-2 py-2 text-xs text-[var(--ds-on-surface-muted)]">and {broken.length - 5} more broken promises. <Link href="/app/fees/dues?overdue=1" className="underline underline-offset-4">Open the overdue list</Link></li> : null}
                </ul>
              ) : <WidgetEmptyState title="All clear" description="UPI payments, cheques, broken promises and requests waiting for a decision appear here." />}
            </Panel>
          </>
        )}
      </PanelGrid>
    </>
  );
}
