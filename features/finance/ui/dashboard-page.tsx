import Link from "next/link";
import { notFound } from "next/navigation";
import { IconAlertTriangle } from "@tabler/icons-react";
import { requireCtx } from "@smw/runtime";
import { todayIST } from "@smw/feature-kit/money";
import { Panel } from "@smw/ui/kit/Panel";
import { AgeingBar } from "@smw/ui/finance/AgeingBar";
import { EmptyLine } from "@smw/ui/finance/States";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { VarianceBar } from "@smw/ui/finance/VarianceBar";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { shortDate } from "@smw/ui/format";
import { cn } from "@smw/ui/utils";
import { canApprove } from "../approvals";
import { MODULE_LINKS } from "../links";
import { FinanceDashboardService } from "../services/dashboard";
import type { ControlCheck } from "../services/control";
import { canOpen } from "./access";
import { JOURNAL_KIND_LABEL } from "./labels";
import { MoneyTrend } from "@smw/ui/finance/MoneyTrend";
import { FLAT, LINK, MUTED, PILL, ROW } from "./styles";
import { monthName } from "@smw/ui/format";

export const metadata = { title: "Finance" };

/** A figure that opens its list when the person can open it, and is plain text when not. */
function Figure({ href, children, className }: { href?: string | null; children: React.ReactNode; className?: string }) {
  return href ? <Link href={href} className={cn("rounded-xl focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]", className)}>{children}</Link> : <div className={className}>{children}</div>;
}

export default async function FinanceDashboardPage({ checks }: { checks?: ControlCheck[] }) {
  const ctx = await requireCtx();
  const svc = new FinanceDashboardService(ctx);
  if (!svc.can("read")) notFound();
  const o = await svc.overview(checks), x = o.extras;
  const today = todayIST(), month = today.slice(0, 7);
  const mayApprove = canApprove(ctx), canReconcile = svc.can("reconcile"), canJournal = svc.can("journal");
  const fees = canOpen(ctx, "fees"), expenses = canOpen(ctx, "expenses");
  const may = (needs: string) => needs === "settings" ? svc.can("settings") : needs === "reconcile" ? canReconcile : needs === "fees-collect" ? canOpen(ctx, "fees", "collect") : canOpen(ctx, "fees", "setup");
  const who = (needs: string) => (needs === "fees-setup" || needs === "fees-collect" ? "Ask an admin or accountant" : "Ask an admin");
  const todo = x.setup.filter((t) => !t.done);
  const stmt = (kind: string, q = "") => `/app/finance/statements/${kind}${q}`;
  const owed = [
    ["Student dues to collect", o.owed.studentDuesPaise], ["Advances held for students", o.owed.studentAdvancesPaise], ["Student deposits held", o.owed.depositsPaise],
    ["Owed to vendors", o.owed.vendorDuesPaise], ["Salaries to pay", o.owed.salaryPayablePaise],
  ] as const;
  const f = x.fees;

  return (
    <>
      <PageHeader eyebrow="Finance" title="Finance" description="Where the money is, what is owed, what moved and what needs a decision."
        actions={<>{canJournal ? <Link href="/app/finance/journals/new" className={PILL}>New journal entry</Link> : null}<Link href="/app/finance/statements" className={PILL}>Statements</Link>{canReconcile ? <Link href="/app/finance/banking" className={PILL}>Banking</Link> : null}</>} />

      {todo.length ? (
        <section aria-labelledby="setup-h" className="mb-8 rounded-3xl bg-[var(--ds-surface-container-low)] p-5">
          <h2 id="setup-h" className="text-[15px] font-medium">Set up your books <span className={cn("ml-1 font-normal", MUTED)}>{x.setup.length - todo.length} of {x.setup.length} done</span></h2>
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {todo.map((t) => <li key={t.key} className="flex flex-wrap items-center justify-between gap-2"><span>{t.text}</span>{may(t.needs) ? <Link href={t.href} className={LINK}>Do it</Link> : <span className={MUTED}>{who(t.needs)}</span>}</li>)}
          </ul>
        </section>
      ) : null}

      {o.mismatches.length ? (
        <section role="alert" aria-labelledby="mismatch-h" className="mb-8 rounded-3xl bg-[var(--ds-color-danger-500)]/10 p-5">
          <h2 id="mismatch-h" className="flex items-center gap-2 text-[15px] font-medium text-[var(--ds-color-danger-300)]"><IconAlertTriangle className="h-4 w-4" aria-hidden />The books do not match</h2>
          <ul className="mt-3 flex flex-col gap-1 text-sm">{o.mismatches.map((m, i) => <li key={i}><span className="text-[var(--ds-on-surface-muted)]">{m.check}: </span>{m.problem}</li>)}</ul>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Panel title="Cash position" className="h-full">
            <Figure href={canReconcile ? "/app/finance/banking" : "/app/finance/accounts"}>
              <p className="text-[13px] text-[var(--ds-on-surface-variant)]">Cash and bank together</p>
              <Money paise={o.cashTotalPaise} className="mt-1 text-[40px] font-medium leading-none" tone={o.cashTotalPaise < 0 ? "danger" : "default"} />
            </Figure>
            <div className="mt-4 grid grid-cols-2 gap-x-6">
              <Figure href={stmt("receipts-payments", `?period=${month}`)} className="py-2"><p className={MUTED}>In this month</p><Money paise={o.monthInPaise} size="lg" /></Figure>
              <Figure href={stmt("receipts-payments", `?period=${month}`)} className="py-2"><p className={MUTED}>Out this month</p><Money paise={o.monthOutPaise} size="lg" /></Figure>
            </div>
            {o.cash.length === 0 ? <EmptyLine title="No cash or bank account yet." hint="Add one under Finance setup." /> : (
              <ul className="mt-2 flex flex-col">
                {o.cash.map((c) => <li key={c.id}><Link href={`/app/finance/accounts/${c.accountId}`} className={ROW}><span className="min-w-0 truncate">{c.name}<span className="ml-2 text-xs text-[var(--ds-on-surface-muted)]">{c.kind === "cash" ? "Cash" : "Bank"}</span></span><Money paise={c.balancePaise} /></Link></li>)}
              </ul>
            )}
          </Panel>
        </div>
        <div className="flex flex-col gap-3 lg:col-span-5">
          <Panel title="Fees this year" className="h-full">
            <Figure href={f.links.due && fees ? f.links.due : stmt("balance-sheet")}>
              <p className="text-[13px] text-[var(--ds-on-surface-variant)]">Still due from families</p>
              <Money paise={f.duePaise} className="mt-1 text-[32px] font-medium leading-none" />
            </Figure>
            <ul className="mt-3 flex flex-col">
              <li><Link href={f.links.billed} className={ROW}><span className="text-[var(--ds-on-surface-variant)]">Billed</span><Money paise={f.billedPaise} /></Link></li>
              <li><Link href={fees ? f.links.collected : stmt("receipts-payments")} className={ROW}><span className="text-[var(--ds-on-surface-variant)]">Collected</span><Money paise={f.collectedPaise} /></Link></li>
              {x.basis === "accrual" ? <li><Link href={f.links.concessions} className={ROW}><span className="text-[var(--ds-on-surface-variant)]">Concessions and write-offs</span><Money paise={f.concessionsPaise} /></Link></li> : null}
            </ul>
            {x.basis === "cash" ? <p className={cn("mt-2", MUTED)}>This school keeps its books on the cash basis, so fees count when they are received.</p> : null}
            {x.ageing && x.ageing.totalPaise > 0 ? <div className="mt-4"><AgeingBar buckets={x.ageing.buckets.map((b) => ({ ...b, href: fees ? b.href : undefined }))} label="Open bills by how late" /></div> : null}
          </Panel>
        </div>

        <div className="lg:col-span-8">
          <Panel title="Money in and out, 12 months" className="h-full"><MoneyTrend height={240} rows={o.trend.map((m) => ({ label: monthName(m.month), in: m.inPaise, out: m.outPaise }))} series={[{ key: "in", label: "Money in", accent: true }, { key: "out", label: "Money out", dashed: true }]} /></Panel>
        </div>
        <div className="lg:col-span-4">
          <Panel title="Needs attention" className="h-full">
            <ul className="flex flex-col">
              <li>{mayApprove ? <Link href="/app/finance/approvals" className={ROW}><span>Waiting for approval</span><span className="tabular-nums">{o.pendingApprovals}</span></Link> : <div className={FLAT}><span>Waiting for approval</span><span className="tabular-nums">{o.pendingApprovals}</span></div>}</li>
              <li>{canReconcile ? <Link href="/app/finance/banking" className={ROW}><span>Bank lines not matched</span><span className="tabular-nums">{x.unmatchedBankLines}</span></Link> : <div className={FLAT}><span>Bank lines not matched</span><span className="tabular-nums">{x.unmatchedBankLines}</span></div>}</li>
              <li>{o.mismatches.length ? <Link href="#mismatch-h" className={ROW}><span>Books that do not match</span><span className="tabular-nums text-[var(--ds-color-danger-400)]">{o.mismatches.length}</span></Link> : <div className={FLAT}><span>Books that do not match</span><span className="tabular-nums">0</span></div>}</li>
            </ul>
            <p className={cn("mt-3", MUTED)}>{o.pendingApprovals === 0 && x.unmatchedBankLines === 0 && o.mismatches.length === 0 ? "All clear." : "Clear these before closing a month."}</p>
          </Panel>
        </div>

        {x.budget ? (
          <div className="lg:col-span-7">
            <Panel title="Spending against budget" className="h-full" action={expenses ? <Link href={x.budget.href} className={cn("text-xs", MUTED, "hover:text-[var(--ds-on-surface)]")}>All budgets</Link> : undefined}>
              <VarianceBar actual={x.budget.toDateActualPaise} budget={x.budget.toDateBudgetPaise} label={`All budgeted accounts, ${x.fy} to date`} />
              <ul className="mt-5 flex flex-col gap-4">{x.budget.rows.map((r) => <li key={r.accountId}><Link href={r.href} className="block rounded-xl focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]"><VarianceBar actual={r.actualPaise} budget={r.budgetPaise} label={r.name} /></Link></li>)}</ul>
            </Panel>
          </div>
        ) : null}
        <div className={x.budget ? "lg:col-span-5" : "lg:col-span-12"}>
          <div className={cn("grid h-full grid-cols-1 gap-3", x.budget ? "" : "sm:grid-cols-2")}>
            <Panel title="Salary share of income">
              <Figure href={stmt("income-expenditure", "?period=FY" + x.from.slice(0, 4))}>
                <p className="text-[32px] font-medium leading-none tabular-nums">{x.salary.shareBp === null ? "-" : `${(x.salary.shareBp / 100).toFixed(1)}%`}</p>
                <p className={cn("mt-2", MUTED)}>{x.salary.shareBp === null ? "No income booked this year yet." : <>of income goes to salaries: <Money paise={x.salary.salaryPaise} size="sm" /> of <Money paise={x.salary.incomePaise} size="sm" />.</>}</p>
              </Figure>
            </Panel>
            <Panel title="Cost per student">
              {x.perStudent ? (
                <Figure href={x.perStudent.href}>
                  <Money paise={x.perStudent.perStudentPaise} className="text-[32px] font-medium leading-none" />
                  <p className={cn("mt-2", MUTED)}>spent so far this year for each of {x.perStudent.students} active students (<Money paise={x.perStudent.expensePaise} size="sm" /> in all).</p>
                </Figure>
              ) : <p className={MUTED}>Shows once students are added.</p>}
            </Panel>
          </div>
        </div>

        <div className="lg:col-span-7">
          <Panel title="Next 90 days" className="h-full">
            <div className="overflow-x-auto"><table className="w-full min-w-[420px] text-sm">
              <caption className="sr-only">Cash forecast for the next 90 days</caption>
              <thead><tr className="text-left font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]"><th className="py-1 font-normal">Period</th><th className="py-1 text-right font-normal">Coming in</th><th className="py-1 text-right font-normal">Going out</th><th className="py-1 text-right font-normal">Cash after</th></tr></thead>
              <tbody>
                <tr><td className="py-2 text-[var(--ds-on-surface-variant)]">Today</td><td /><td /><td className="py-2 text-right"><Money paise={x.forecast.openingPaise} /></td></tr>
                {x.forecast.months.map((m) => <tr key={m.label}><td className="py-2">{m.label}</td><td className="py-2 text-right"><Money paise={m.inPaise || null} /></td><td className="py-2 text-right"><Money paise={m.outPaise || null} /></td><td className="py-2 text-right"><Money paise={m.closingPaise} tone={m.closingPaise < 0 ? "danger" : "default"} /></td></tr>)}
              </tbody>
            </table></div>
            <ul className={cn("mt-3 flex flex-col gap-1", MUTED)}>{x.forecast.notes.map((n) => <li key={n}>{n}</li>)}</ul>
            <p className={cn("mt-2", MUTED)}>{fees ? <Link href={MODULE_LINKS.dues} className={LINK}>Open dues</Link> : null}{fees && expenses ? " · " : ""}{expenses ? <Link href={MODULE_LINKS.bills} className={LINK}>Open bills</Link> : null}</p>
          </Panel>
        </div>
        <div className="lg:col-span-5">
          <Panel title="Owed and held" className="h-full">
            <ul className="flex flex-col">{owed.map(([label, v]) => <li key={label} className={FLAT}><span className="text-[var(--ds-on-surface-variant)]">{label}</span><Money paise={v} /></li>)}</ul>
          </Panel>
        </div>

        <div className="lg:col-span-12">
          <Panel title="Latest entries" action={<Link href="/app/finance/journals" className="text-xs text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">All entries</Link>}>
            {o.recent.length === 0 ? <EmptyLine title="No entries yet." hint="Receipts, bills and payroll post here by themselves." /> : (
              <ul className="flex flex-col">
                {o.recent.map((j) => (
                  <li key={j.id}>
                    <Link href={`/app/finance/journals/${j.id}`} className={ROW}>
                      <span className="min-w-0"><span className="block truncate">{j.memo}</span><span className="block truncate font-mono text-xs text-[var(--ds-on-surface-muted)]">{j.number} · {shortDate(j.date)} · {JOURNAL_KIND_LABEL[j.kind as keyof typeof JOURNAL_KIND_LABEL] ?? j.kind}</span></span>
                      <span className="flex items-center gap-3">{j.reversesId ? <StateBadge state="reversed" /> : null}<Money paise={j.totalPaise} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
