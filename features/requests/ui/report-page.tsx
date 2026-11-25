import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { KpiRow } from "@smw/ui/shell/PageHeader";
import { StatCard } from "@smw/ui/kit/StatCard";
import { Panel } from "@smw/ui/kit/Panel";
import { buttonVariants } from "@smw/ui/ui/button";
import { EmptyLine } from "@smw/ui/finance/States";
import { hoursWords } from "../clock";
import { REQUEST_STATE_WORDS, type RequestState } from "../constants";
import { ReportService } from "../report";
import { NoAccess, SectionNav, can, one, type Search } from "./shared";

export const metadata = { title: "Request report" };

export default async function ReportPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "manage")) return <NoAccess what="The request report" who="admins" />;
  const sp = await searchParams;
  const from = one(sp.from), to = one(sp.to);
  const r = await new ReportService(ctx).summary({ from: from || undefined, to: to || undefined });
  const top = Math.max(1, ...r.byCategory.map((c) => c.total));
  const states = (Object.keys(REQUEST_STATE_WORDS) as RequestState[]).map((s) => ({ s, n: r.byState[s] }));
  return (
    <>
      <PageHeader eyebrow="Communication" title="Request report" description="How fast the school answers, by category and state. Only requests you may see are counted."
        actions={<Link href="/api/requests/csv?view=all" prefetch={false} className={buttonVariants({ variant: "ghost", className: "rounded-full" })}>Download CSV</Link>} />
      <SectionNav ctx={ctx} current="/app/requests/report" />
      <form className="mb-6 flex flex-wrap items-end gap-3" role="search">
        <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">From<input type="date" name="from" defaultValue={from} className="h-10 rounded-xl bg-white/[0.05] px-3 text-sm text-[var(--ds-on-surface)]" /></label>
        <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">To<input type="date" name="to" defaultValue={to} className="h-10 rounded-xl bg-white/[0.05] px-3 text-sm text-[var(--ds-on-surface)]" /></label>
        <button className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Show</button>
        {from || to ? <Link href="/app/requests/report" className="pb-2 text-sm underline underline-offset-4">Clear dates</Link> : null}
      </form>
      {r.total === 0 ? <EmptyLine title="No requests in this time." hint="Pick other dates, or clear them." /> : (
        <>
          <KpiRow>
            <StatCard label="Requests" value={String(r.total)} meta={`${r.open} still open`} href="/app/requests?view=all" />
            <StatCard label="Overdue now" value={String(r.overdue)} meta="Past the target days" href="/app/requests?view=overdue" />
            <StatCard label="Time to first answer" value={hoursWords(r.medianFirstAnswerHours)} meta="Median" />
            <StatCard label="Time to resolve" value={hoursWords(r.medianResolveHours)} meta={`Median. ${r.reopened} opened again`} />
          </KpiRow>
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="By category">
              <ul className="flex flex-col gap-3">
                {r.byCategory.map((c) => (
                  <li key={c.name}>
                    <p className="flex justify-between gap-3 text-sm"><span className="truncate">{c.name}</span><span className="tabular-nums text-[var(--ds-on-surface-muted)]">{c.total}{c.overdue ? ` · ${c.overdue} late` : ""}</span></p>
                    <div className="mt-1 h-2 rounded-full bg-white/[0.06]" role="img" aria-label={`${c.name}: ${c.total} requests, ${c.open} open`}><div className="h-2 rounded-full bg-[var(--ds-on-surface)]/70" style={{ width: `${(c.total / top) * 100}%` }} /></div>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="By state">
              <ul className="flex flex-col gap-2">
                {states.map(({ s, n }) => <li key={s} className="flex justify-between text-sm"><span>{REQUEST_STATE_WORDS[s]}</span><span className="tabular-nums">{n}</span></li>)}
              </ul>
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
