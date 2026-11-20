import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { StatCard } from "@smw/ui/kit/StatCard";
import { HatchedBars } from "@smw/ui/kit/HatchedBars";
import { Panel } from "@smw/ui/kit/Panel";
import { LABEL, ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { KpiRow, PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { MenuIconView } from "@smw/ui/shell/icons";
import { initials, paise, shortDate } from "@smw/ui/format";
import { DuesService, METHOD_LABEL } from "../service";
import { CollectionTrend } from "./collection-trend";
import { STATUS_LABELS, STATUS_TONES, tile, whole } from "./fields";
import { StudentFinder } from "./student-finder";

export const metadata = { title: "Fees" };

const columns: Column[] = [
  { key: "name", label: "Student", type: "person", metaKey: "meta" },
  { key: "late", label: "Late fee", type: "money", hideOnMobile: true },
  { key: "paid", label: "Paid", type: "money", hideOnMobile: true },
  { key: "due", label: "Due", type: "money" },
  { key: "nextDueDate", label: "Next due", type: "date", hideOnMobile: true },
  { key: "status", label: "Status", type: "badge", tones: STATUS_TONES, labels: STATUS_LABELS },
];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function FeesDashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireCtx();
  const dues = new DuesService(ctx);
  if (!dues.can("read")) return dues.can("self") ? <MyFees dues={dues} /> : notFound();

  const sp = await searchParams;
  const [overview, report, days, months, classes] = await Promise.all([
    dues.overview(), dues.duesReport(listQueryFrom(sp)), dues.collectionTrend("day", 30), dues.collectionTrend("month", 12), dues.classOptions(),
  ]);
  const { summary, byClass, chase, today } = overview;
  const rows = report.rows.map((r) => ({ ...r, meta: `${r.admissionNo} · ${r.classLabel}` }));
  const manage = dues.can("manage");
  const setup = manage ? (
    <Link href="/app/fees/setup" className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm font-medium hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Fee setup</Link>
  ) : null;
  const todayTotal = today.byMethod.reduce((s, m) => s + m.paise, 0);
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const filtered = Boolean(sp.q || sp.classId || sp.overdue);

  return (
    <>
      <PageHeader eyebrow="Finance" title="Fees" description="Collect at the counter, see today's money and who to chase." actions={setup} />
      {manage ? <div className="pb-8"><StudentFinder /></div> : null}
      <KpiRow>
        <StatCard label="Today" value={tile(summary.collectedToday)} icon={<MenuIconView name="money" />} meta={summary.receiptsToday ? `${plural(summary.receiptsToday, "receipt")} · ${paise(summary.collectedToday)}` : "No receipts yet"} />
        <StatCard label="This month" value={tile(summary.collectedThisMonth)} icon={<MenuIconView name="check" />} meta={`${plural(summary.receiptsThisMonth, "receipt")} · ${tile(summary.collectedThisYear)} this year`} />
        <StatCard label="Outstanding" value={tile(summary.outstanding)} icon={<MenuIconView name="receipt" />} meta={`${plural(summary.studentsWithDues, "student")} owe fees`} />
        <StatCard label="Overdue" value={tile(summary.overdueAmount)} icon={<MenuIconView name="clock" />} href="/app/fees?overdue=1#dues" meta={summary.overdueCount ? `${plural(summary.overdueCount, "student")} to chase` : "Nobody is behind"} />
      </KpiRow>

      <div className="grid grid-cols-1 gap-3 pb-3 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <Panel title="Today's collection" className="h-full" action={manage ? <span className={LABEL}>{shortDate(new Date())}</span> : undefined}>
            <p className="text-[34px] font-medium tabular-nums tracking-tight">{whole(todayTotal)}</p>
            {today.receipts.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--ds-on-surface-muted)]">Nothing collected yet today. {manage ? "Search a student above to record a payment." : ""}</p>
            ) : (
              <>
                <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">{today.byMethod.map((m) => `${METHOD_LABEL[m.method]} ${whole(m.paise)}`).join(" · ")}</p>
                <ul className="mt-4 flex flex-col">
                  {today.receipts.map((r) => (
                    <li key={r.id}>
                      <Link href={`/app/fees/students/${r.studentId}`} className="flex min-h-11 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{r.student}</span>
                          <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{METHOD_LABEL[r.method]} · {r.receiptNo}</span>
                        </span>
                        <span className="text-sm tabular-nums">{paise(r.amountPaise)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        </div>
        <div className="lg:col-span-6">
          <Panel title="Dues by class" className="h-full">
            {byClass.length === 0 ? <WidgetEmptyState title="No fees set up yet." description="Set up fees for a class and its dues appear here." /> : (
              <>
                <p className="mb-4 text-xs text-[var(--ds-on-surface-muted)]">Tap a class to see its students.</p>
                <HatchedBars height={190} items={byClass.map((c) => ({ key: c.classId, label: c.name.replace(/^class\s+/i, ""), value: c.due / 100, display: tile(c.due), href: `/app/fees?classId=${c.classId}#dues` }))} />
              </>
            )}
          </Panel>
        </div>
        <div className="lg:col-span-5">
          <Panel title="Who to chase" className="h-full">
            {chase.length === 0 ? <WidgetEmptyState title="Nobody is overdue." description="Students who miss a due date show up here, biggest amount first." /> : (
              <ul className="flex flex-col">
                {chase.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <Link href={`/app/fees/students/${c.id}`} className="flex min-h-11 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-xs" aria-hidden>{initials(c.name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{c.name}</span>
                        <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{c.classLabel}{c.nextDueDate ? ` · due ${shortDate(c.nextDueDate)}` : ""}</span>
                      </span>
                      <span className="text-sm tabular-nums text-[var(--ds-color-danger-300)]">{whole(c.overdue)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="lg:col-span-7"><CollectionTrend days={days} months={months} /></div>
      </div>

      <section id="dues" aria-labelledby="dues-h" className="scroll-mt-4 pt-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="dues-h" className="text-[15px] font-medium">Dues by student</h2>
          <p className="text-xs text-[var(--ds-on-surface-muted)]">
            {plural(report.total, "student")}{filtered ? " match" : ""} · {whole(report.totals.due)} due{report.totals.overdue ? ` · ${whole(report.totals.overdue)} overdue` : ""}
          </p>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          total={report.total}
          page={report.page}
          pageCount={report.pageCount}
          rowHref="/app/fees/students/{id}"
          searchPlaceholder="Search by name or admission number"
          filters={[
            { key: "classId", label: "Class", options: classes.map((c) => ({ value: c.id, label: c.name })) },
            { key: "overdue", label: "Show", options: [{ value: "1", label: "Overdue only" }] },
          ]}
          empty={{
            title: filtered ? "No students match." : "No fee structures yet.",
            description: filtered ? "Clear the search or filters to see everyone." : "Set up fees for a class and its students show up here with what they owe.",
            action: !filtered && manage ? <Link href="/app/fees/setup" className="text-sm text-[var(--ds-color-primary-300)] underline-offset-4 hover:underline">Set up fees</Link> : undefined,
          }}
        />
      </section>
    </>
  );
}

/** Students: straight to their ledger. */
async function MyFees({ dues }: { dues: DuesService }) {
  const kids = await dues.mine();
  const totalDue = kids.reduce((t, k) => t + k.due, 0);
  if (kids.length === 1) redirect(`/app/fees/students/${kids[0]!.id}`);
  return (
    <>
      <PageHeader eyebrow="Finance" title="My fees" description="What is due, what is paid and your receipts." />
      <Panel title="Fees" className="h-auto" action={totalDue ? <span className="text-sm tabular-nums">{paise(totalDue)} due in all</span> : undefined}>
        {kids.length === 0 ? <WidgetEmptyState title="No fees to show yet." description="Fees appear here once the school sets them up." /> : (
          <ul className="flex flex-col">
            {kids.map((k) => (
              <li key={k.id}>
                <Link href={`/app/fees/students/${k.id}`} className="flex items-center gap-3 rounded-2xl px-2 py-3 transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-xs" aria-hidden>{initials(k.name)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{k.name}</span>
                    <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{k.classLabel}{k.nextDueDate ? ` · next due ${shortDate(k.nextDueDate)}` : ""}</span>
                  </span>
                  <span className="text-sm tabular-nums">{paise(k.due)}</span>
                  <ToneBadge label={STATUS_LABELS[k.status]} tone={STATUS_TONES[k.status]} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
