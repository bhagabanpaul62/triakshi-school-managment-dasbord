import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader, KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { MenuIconView } from "@smw/ui/shell/icons";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { HatchedBars } from "@smw/ui/kit/HatchedBars";
import { ToneBadge, WidgetEmptyState, ROW_HOVER } from "@smw/ui/widgets/WidgetPrimitives";
import { buttonVariants } from "@smw/ui/ui/button";
import { paise, shortDate } from "@smw/ui/format";
import { LOAN_DAYS } from "../rules";
import { LibraryStats, LoanService } from "../service";
import { returnLoan } from "./actions";
import { IssueDesk } from "./issue-desk";
import { MyLoans } from "./my-loans";
import { returnConfirm } from "./return-confirm";

export const metadata = { title: "Library" };

export default async function LibraryPage() {
  const ctx = await requireCtx();
  const loans = new LoanService(ctx);

  if (!loans.can("read")) {
    return (
      <>
        <PageHeader eyebrow="Academics" title="Library" description="Your books and any fines." />
        <MyLoans rows={await loans.mine()} showName={ctx.role === "parent"} />
      </>
    );
  }

  const stats = new LibraryStats(ctx);
  const [s, popular, overdue] = await Promise.all([stats.summary(), stats.popular(6), loans.overdue(10)]);
  const canManage = loans.can("manage");

  return (
    <>
      <PageHeader eyebrow="Academics" title="Library" description="Books out, books overdue and what students read most."
        actions={<>
          <Link href="/app/library/loans" className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>All loans</Link>
          <Link href="/app/library/books" className={buttonVariants({ className: "rounded-full" })}>Books</Link>
        </>} />
      <KpiRow>
        <StatCard label="Issued now" value={String(s.issuedNow)} icon={<MenuIconView name="book" />} href="/app/library/loans?status=open" />
        <StatCard label="Overdue" value={String(s.overdue)} icon={<MenuIconView name="clock" />} href="/app/library/loans?status=overdue" />
        <StatCard label="Books" value={s.titles.toLocaleString("en-IN")} icon={<MenuIconView name="library" />} meta={`${s.availableCopies} of ${s.copies} copies on the shelf`} href="/app/library/books" />
        <StatCard label="Fines running" value={paise(s.accruedFinePaise)} icon={<MenuIconView name="money" />} meta="on books still out" />
      </KpiRow>
      {canManage ? <div className="pb-3"><IssueDesk /></div> : null}
      <PanelGrid>
        <div className="lg:col-span-7">
          <Panel title="Overdue books" action={s.overdue > 10 ? <Link href="/app/library/loans?status=overdue" className="text-xs text-[var(--ds-on-surface-variant)] hover:underline">All {s.overdue}</Link> : null}>
            {overdue.rows.length === 0 ? <WidgetEmptyState title="Nothing is overdue." description={`Every book out is still within its ${LOAN_DAYS} days.`} /> : (
              <ul className="flex flex-col">
                {overdue.rows.map((r) => (
                  <li key={r.id} className={`flex flex-col gap-2 rounded-2xl px-2 py-3 sm:flex-row sm:items-center sm:gap-3 ${ROW_HOVER}`}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm" title={r.title}>{r.title}</span>
                      <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{[r.borrowerName, r.classLabel ?? r.borrowerMeta, `due ${shortDate(r.dueOn)}`].join(" · ")}</span>
                      {r.chasePhone ? <a href={`tel:${r.chasePhone}`} className="mt-0.5 inline-flex min-h-6 items-center text-xs text-[var(--ds-on-surface-variant)] underline-offset-2 hover:underline">Parent: {r.chasePhone}</a> : null}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <ToneBadge label={`${r.daysLate} ${r.daysLate === 1 ? "day" : "days"} late`} tone="danger" />
                      <span className="text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{r.finePaise ? paise(r.finePaise) : "No fine"}</span>
                      {canManage ? <ActionButton label="Return" variant="secondary" action={returnLoan} values={{ id: r.id }} confirm={returnConfirm(r)} /> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="lg:col-span-5">
          <Panel title="Most borrowed">
            {popular.length === 0 ? <WidgetEmptyState title="No loans yet." description="Popular books appear after the first few are issued." /> : (
              <div className="flex flex-col gap-4">
                <HatchedBars height={170} items={popular.map((p) => ({ key: p.bookId, label: p.title.length > 12 ? `${p.title.slice(0, 11)}…` : p.title, value: p.loans, display: `${p.title}: ${p.loans}`, href: `/app/library/books/${p.bookId}` }))} />
                <p className="text-xs text-[var(--ds-on-surface-muted)]">Times each title has been lent. Tap a bar to open the book.</p>
              </div>
            )}
          </Panel>
        </div>
      </PanelGrid>
    </>
  );
}
