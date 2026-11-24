import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader, KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { MenuIconView } from "@smw/ui/shell/icons";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { HatchedBars } from "@smw/ui/kit/HatchedBars";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { ROW_HOVER } from "@smw/ui/tone";
import { buttonVariants } from "@smw/ui/ui/button";
import { paise, shortDate } from "@smw/ui/format";
import { CatalogueService, HoldService, LibrarySettingsService, LibraryStats, LoanService } from "../service";
import { cancelHold, returnLoan, saveSettings } from "./actions";
import { FormModal } from "@smw/ui/shell/FormModal";
import { settingsFields, settingsValues } from "./fields";
import { Opac } from "./opac";
import { IssueDesk } from "./issue-desk";
import { MyLoans } from "./my-loans";
import { returnConfirm } from "./return-confirm";

export const metadata = { title: "Library" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function LibraryPage({ searchParams }: { searchParams?: Search }) {
  const ctx = await requireCtx();
  const loans = new LoanService(ctx);
  const sp = (await searchParams) ?? {};

  if (!loans.can("read")) {
    return (
      <>
        <PageHeader eyebrow="Academics" title="Library" description="Your books and any fines." />
        <MyLoans rows={await loans.mine()} />
        <div className="h-3" />
        <StudentCatalogue ctx={ctx} q={one(sp.q)} category={one(sp.category)} />
      </>
    );
  }

  const stats = new LibraryStats(ctx);
  const [s, popular, overdue, rules, holds] = await Promise.all([stats.summary(), stats.popular(6), loans.overdue(10), new LibrarySettingsService(ctx).get(), new HoldService(ctx).queue()]);
  const canManage = loans.can("manage");
  const scanned = canManage && one(sp.scan) ? await loans.scan(one(sp.scan)).catch(() => null) : null;

  return (
    <>
      <PageHeader eyebrow="Academics" title="Library" description="Books out, books overdue and what students read most."
        actions={<>
          {canManage ? <FormModal title="Library rules" icon="library" fields={settingsFields} values={settingsValues(rules)} action={saveSettings} submitLabel="Save rules" trigger={{ label: "Rules", variant: "secondary", plus: false }} /> : null}
          <Link href="/app/library/loans" className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>All loans</Link>
          <Link href="/app/library/books" className={buttonVariants({ className: "rounded-full" })}>Books</Link>
        </>} />
      <KpiRow>
        <StatCard label="Issued now" value={String(s.issuedNow)} icon={<MenuIconView name="book" />} href="/app/library/loans?status=open" />
        <StatCard label="Overdue" value={String(s.overdue)} icon={<MenuIconView name="clock" />} href="/app/library/loans?status=overdue" />
        <StatCard label="Books" value={s.titles.toLocaleString("en-IN")} icon={<MenuIconView name="library" />} meta={`${s.availableCopies} of ${s.copies} copies on the shelf`} href="/app/library/books" />
        <StatCard label="Fines running" value={paise(s.accruedFinePaise)} icon={<MenuIconView name="money" />} meta="on books still out" />
      </KpiRow>
      {canManage ? <div className="pb-3"><IssueDesk rules={rules} initial={scanned?.state === "available" ? scanned.book : undefined} /></div> : null}
      <PanelGrid>
        <div className="lg:col-span-7">
          <Panel title="Overdue books" action={s.overdue > 10 ? <Link href="/app/library/loans?status=overdue" className="text-xs text-[var(--ds-on-surface-variant)] hover:underline">All {s.overdue}</Link> : null}>
            {overdue.rows.length === 0 ? <WidgetEmptyState title="Nothing is overdue." description={`Every book out is still within its ${rules.loanDays} days.`} /> : (
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
                      <Link href={`/app/library/members/${r.borrowerKind}/${r.studentId ?? r.userId}`} className="inline-flex min-h-8 items-center text-xs text-[var(--ds-on-surface-variant)] underline-offset-2 hover:underline">History</Link>
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
      {holds.length ? (
        <Panel title="Reservations">
          <ul className="flex flex-col">
            {holds.map((h) => (
              <li key={h.id} className={`flex flex-wrap items-center gap-3 rounded-2xl px-2 py-3 ${ROW_HOVER}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm" title={h.title}>{h.title}</span>
                  <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{h.holder}{h.status === "ready" && h.readyUntil ? ` · kept until ${shortDate(h.readyUntil)}` : ""}</span>
                </span>
                <ToneBadge label={h.status === "ready" ? "Ready" : "Waiting"} tone={h.status === "ready" ? "success" : "info"} />
                {canManage ? <ActionButton label="Cancel" variant="ghost" action={cancelHold} values={{ id: h.id }} /> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}

async function StudentCatalogue({ ctx, q, category }: { ctx: Awaited<ReturnType<typeof requireCtx>>; q: string; category: string }) {
  const cat = new CatalogueService(ctx);
  const [rows, categories, holds] = await Promise.all([cat.search(q, category || undefined), cat.categories(), new HoldService(ctx).mine()]);
  return <Opac rows={rows} holds={holds} q={q} category={category} categories={categories} />;
}
