import Link from "next/link";
import { SupportDeskService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { PageHeader, KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { ProgressList, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { PILL_BTN } from "@smw/ui/finance/ui";
import { shortDate } from "@smw/ui/format";
import { CATEGORY_LABELS } from "@smw/feature-support/inputs";
import { articleBySlug } from "@smw/feature-support/articles";
import { cn } from "@smw/ui/utils";

export const metadata = { title: "Support reports" };

const RANGES = [{ days: 7, label: "7 days" }, { days: 30, label: "30 days" }, { days: 90, label: "90 days" }, { days: 365, label: "A year" }];
const top = (rows: { n: number }[]) => Math.max(1, ...rows.map((r) => r.n));
const hours = (h: number | null) => (h == null ? "-" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`);

export default async function SupportReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const days = RANGES.find((r) => String(r.days) === String(Array.isArray(sp.days) ? sp.days[0] : sp.days))?.days ?? 30;
  const r = await new SupportDeskService(await requireStaff()).report(days);

  return (
    <>
      <PageHeader eyebrow="Business" title="Support reports" description={`Tickets since ${shortDate(r.since)}.`}
        actions={<Link href="/support" className={PILL_BTN}>Back to the queue</Link>} />
      <nav aria-label="Period" className="mb-6 flex flex-wrap gap-2">
        {RANGES.map((x) => <Link key={x.days} href={`/support/report?days=${x.days}`} aria-current={x.days === days ? "page" : undefined}
          className={cn("inline-flex min-h-9 items-center rounded-full px-3 text-sm", x.days === days ? "bg-[var(--ds-on-surface)] font-medium text-[var(--ds-surface)]" : "bg-white/[0.06] text-[var(--ds-on-surface-variant)] hover:bg-white/[0.1]")}>{x.label}</Link>)}
      </nav>
      {r.total === 0 ? <WidgetEmptyState title="No tickets in this period." description="Pick a longer period above." /> : (
        <>
          <KpiRow>
            <StatCard label="Tickets" value={String(r.total)} />
            <StatCard label="First reply (middle)" value={hours(r.firstReply.medianHours)} />
            <StatCard label="Reply target met" value={r.slaMetPercent == null ? "-" : `${r.slaMetPercent}%`} />
            <StatCard label="Rating" value={r.rating.average == null ? "-" : `${r.rating.average.toFixed(1)} of 5`} />
          </KpiRow>
          <PanelGrid>
            <div className="lg:col-span-6"><Panel title="By type">
              <ProgressList items={r.byCategory.map((c) => ({ id: c.category, label: CATEGORY_LABELS[c.category], value: String(c.n), progress: (c.n / top(r.byCategory)) * 100 }))} maxItems={8} empty={{ title: "No tickets.", description: "Nothing in this period." }} />
            </Panel></div>
            <div className="lg:col-span-6"><Panel title="By school (top 10)">
              <ProgressList items={r.bySchool.map((c) => ({ id: c.schoolId, label: c.school, value: String(c.n), progress: (c.n / top(r.bySchool)) * 100, href: `/schools/${c.schoolId}` }))} maxItems={10} empty={{ title: "No tickets.", description: "Nothing in this period." }} />
            </Panel></div>
            <div className="lg:col-span-6"><Panel title="Times">
              <dl className="grid grid-cols-2 gap-y-3 text-sm">
                <dt className="text-[var(--ds-on-surface-muted)]">First reply, middle</dt><dd className="text-right tabular-nums">{hours(r.firstReply.medianHours)}</dd>
                <dt className="text-[var(--ds-on-surface-muted)]">First reply, slowest 1 in 10</dt><dd className="text-right tabular-nums">{hours(r.firstReply.p90Hours)}</dd>
                <dt className="text-[var(--ds-on-surface-muted)]">Solved, middle</dt><dd className="text-right tabular-nums">{hours(r.resolution.medianHours)}</dd>
                <dt className="text-[var(--ds-on-surface-muted)]">Solved, slowest 1 in 10</dt><dd className="text-right tabular-nums">{hours(r.resolution.p90Hours)}</dd>
                <dt className="text-[var(--ds-on-surface-muted)]">Ratings given</dt><dd className="text-right tabular-nums">{r.rating.n}</dd>
              </dl>
              <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">Wall-clock hours from the ticket being sent. The target counts working hours (9 to 18, Monday to Saturday).</p>
            </Panel></div>
            <div className="lg:col-span-6"><Panel title="Help articles marked not useful">
              {r.notUseful.length === 0 ? <p className="text-sm text-[var(--ds-on-surface-muted)]">No votes in this period.</p> : (
                <ul className="flex flex-col gap-2 text-sm">{r.notUseful.map((v) => (
                  <li key={v.article} className="flex items-center justify-between gap-3"><span className="min-w-0 truncate">{articleBySlug(v.article)?.title ?? v.article}</span><span className="shrink-0 tabular-nums text-[var(--ds-on-surface-muted)]">{v.no} no, {v.yes} yes</span></li>
                ))}</ul>
              )}
            </Panel></div>
          </PanelGrid>
        </>
      )}
    </>
  );
}
