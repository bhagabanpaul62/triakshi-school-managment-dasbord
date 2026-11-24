import Link from "next/link";
import { notFound } from "next/navigation";
import { IconAlertTriangle } from "@tabler/icons-react";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { EmptyLine } from "@smw/ui/finance/States";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { KpiRow, PageHeader } from "@smw/ui/shell/PageHeader";
import { MenuIconView } from "@smw/ui/shell/icons";
import { paise, shortDate } from "@smw/ui/format";
import { ApprovalService } from "../approvals";
import { FinanceDashboardService } from "../services/dashboard";
import { JOURNAL_KIND_LABEL } from "./labels";
import { MoneyTrend } from "./money-trend";

export const metadata = { title: "Finance" };

const PILL = "inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm font-medium hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";
const ROW = "flex min-h-11 items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";

export default async function FinanceDashboardPage() {
  const ctx = await requireCtx();
  const svc = new FinanceDashboardService(ctx);
  if (!svc.can("read")) notFound();
  const o = await svc.overview();
  const canJournal = svc.can("journal"), canApprove = new ApprovalService(ctx, {}).can("approve");
  const owed = [
    ["Student dues to collect", o.owed.studentDuesPaise], ["Advances held for students", o.owed.studentAdvancesPaise], ["Student deposits held", o.owed.depositsPaise],
    ["Owed to vendors", o.owed.vendorDuesPaise], ["Salaries to pay", o.owed.salaryPayablePaise],
  ] as const;

  return (
    <>
      <PageHeader eyebrow="Finance" title="Finance" description="Where the money is, what moved this month and what needs a decision."
        actions={<>{canJournal ? <Link href="/app/finance/journals/new" className={PILL}>New journal entry</Link> : null}<Link href="/app/finance/banking" className={PILL}>Banking</Link></>} />

      {o.mismatches.length ? (
        <section role="alert" aria-labelledby="mismatch-h" className="mb-8 rounded-3xl bg-[var(--ds-color-danger-500)]/10 p-5">
          <h2 id="mismatch-h" className="flex items-center gap-2 text-[15px] font-medium text-[var(--ds-color-danger-300)]"><IconAlertTriangle className="h-4 w-4" aria-hidden />The books do not match</h2>
          <ul className="mt-3 flex flex-col gap-1 text-sm">{o.mismatches.map((m, i) => <li key={i}><span className="text-[var(--ds-on-surface-muted)]">{m.check}: </span>{m.problem}</li>)}</ul>
        </section>
      ) : null}

      <KpiRow>
        <StatCard label="Cash and bank" value={paise(o.cashTotalPaise)} icon={<MenuIconView name="money" />} href="/app/finance/banking" meta={`${o.cash.length} account${o.cash.length === 1 ? "" : "s"}`} />
        <StatCard label="Money in this month" value={paise(o.monthInPaise)} icon={<MenuIconView name="check" />} meta="Receipts and other income" />
        <StatCard label="Money out this month" value={paise(o.monthOutPaise)} icon={<MenuIconView name="receipt" />} meta="Payments and expenses" />
        <StatCard label="Waiting for approval" value={String(o.pendingApprovals)} icon={<MenuIconView name="clock" />} href={canApprove ? "/app/finance/approvals" : undefined} meta={o.pendingApprovals ? "Needs a second person" : "All clear"} />
      </KpiRow>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Panel title="Money in and out, 12 months" className="h-full"><MoneyTrend months={o.trend} /></Panel>
        </div>
        <div className="lg:col-span-4">
          <Panel title="Cash position" className="h-full">
            {o.cash.length === 0 ? <EmptyLine title="No cash or bank account yet." hint="Add one under Finance setup." /> : (
              <ul className="flex flex-col">
                {o.cash.map((c) => (
                  <li key={c.id}><Link href={`/app/finance/accounts/${c.accountId}`} className={ROW}><span className="min-w-0 truncate">{c.name}<span className="ml-2 text-xs text-[var(--ds-on-surface-muted)]">{c.kind === "cash" ? "Cash" : "Bank"}</span></span><Money paise={c.balancePaise} /></Link></li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="lg:col-span-5">
          <Panel title="Owed and held" className="h-full">
            <ul className="flex flex-col">{owed.map(([label, v]) => <li key={label} className={ROW.replace("hover:bg-white/[0.04]", "")}><span className="text-[var(--ds-on-surface-variant)]">{label}</span><Money paise={v} /></li>)}</ul>
          </Panel>
        </div>
        <div className="lg:col-span-7">
          <Panel title="Latest entries" className="h-full" action={<Link href="/app/finance/journals" className="text-xs text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">All entries</Link>}>
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
