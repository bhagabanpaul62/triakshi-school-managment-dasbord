import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { qrSvg } from "@smw/integrations";
import { StatCard } from "@smw/ui/kit/StatCard";
import { Panel } from "@smw/ui/kit/Panel";
import { DeltaChip } from "@smw/ui/kit/DeltaChip";
import { CopyValue } from "@smw/ui/finance/CopyValue";
import { PILL_BTN } from "@smw/ui/finance/ui";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { InsightsService } from "../service";
import { shortDate } from "@smw/ui/format";
import { VisitsTrend } from "./visits-trend";
import { liveOrigin } from "./address";
import { WebsiteNav } from "./website-nav";

export const metadata = { title: "Website insights" };
const M = "text-[var(--ds-on-surface-muted)]";
const ORIGIN = { direct: "Typed or saved link", search: "Search engines", social: "Social media", other: "Other sites" } as const;
const pct = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;

export default async function InsightsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new InsightsService(ctx);
  if (!svc.canSee()) return <NoAccess title="You cannot open the website screens." hint="Ask your admin to give your role access to the website." />;
  const sp = await searchParams;
  const days = (Array.isArray(sp.days) ? sp.days[0] : sp.days) === "90" ? 90 : 30;
  const [i, origin] = await Promise.all([svc.insights(days), liveOrigin()]);
  const top = Math.max(1, ...i.top.map((t) => t.views));
  const sources = (Object.keys(ORIGIN) as (keyof typeof ORIGIN)[]).map((k) => ({ k, v: i.origins[k] })).sort((a, b) => b.v - a.v);
  const change = i.before ? Math.round(((i.views - i.before) / i.before) * 100) : null;

  return (
    <>
      <PageHeader eyebrow="Website" title="Insights" description="Visits are counted without cookies and without anything about the visitor. Staff and robots are left out."
        actions={<div className="flex gap-1 rounded-full bg-white/[0.05] p-1" role="group" aria-label="Period">
          {([30, 90] as const).map((d) => <Link key={d} href={`/app/website/insights?days=${d}`} aria-current={d === days} className={`inline-flex min-h-9 items-center rounded-full px-4 text-sm ${d === days ? "bg-white/[0.12]" : M}`}>{d} days</Link>)}
        </div>} />
      <WebsiteNav />

      {i.views === 0 ? (
        <Panel title="No visits yet" className="h-auto">
          <p className={`mb-4 max-w-xl text-sm ${M}`}>Nobody has opened your website in the last {days} days. Share the address, put the QR code on the school gate and in the admission form, and the numbers fill in here.</p>
          <div className="flex flex-wrap items-center gap-4">
            <div className="h-32 w-32 overflow-hidden rounded-2xl bg-white" role="img" aria-label={`QR code for ${origin}`} dangerouslySetInnerHTML={{ __html: qrSvg(origin) }} />
            <div><CopyValue value={origin} label="website address" maxWidth="28ch" /><div className="mt-3"><a href="/app/website/poster" className={PILL_BTN}>Download poster (PDF)</a></div></div>
          </div>
        </Panel>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={`Visits, ${days} days`} value={i.views.toLocaleString("en-IN")} delta={change === null ? undefined : <DeltaChip direction={change >= 0 ? "up" : "down"} tone={change >= 0 ? "success" : "warning"}>{Math.abs(change)}%</DeltaChip>} meta={change === null ? undefined : `vs the ${days} days before`} />
            <StatCard label="Enquiries" value={i.enquiries.toLocaleString("en-IN")} href="/app/enquiries" />
            <StatCard label="Visits that became an enquiry" value={i.rate === null ? "-" : pct(i.rate)} />
            <StatCard label="Busiest page" value={i.top[0] ? i.top[0].views.toLocaleString("en-IN") : "-"} meta={i.top[0] ? `visits to ${i.top[0].title}` : undefined} />
          </div>
          <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-12">
            <Panel title="Visits per day" className="h-auto lg:col-span-8">
              <VisitsTrend points={i.byDay.map((d, k) => ({ day: shortDate(d.day), views: d.views, enquiries: i.enquiriesByDay[k]?.n ?? 0 }))} />
            </Panel>
            <Panel title="Where visitors come from" className="h-auto lg:col-span-4">
              <ul className="flex flex-col gap-3">
                {sources.map(({ k, v }) => (
                  <li key={k}><div className="flex justify-between text-sm"><span>{ORIGIN[k]}</span><span className="tabular-nums">{v.toLocaleString("en-IN")}</span></div>
                    <div className="mt-1 h-2 rounded-full bg-white/[0.06]"><div className="h-2 rounded-full bg-[var(--ds-primary)]" style={{ width: `${(v / i.views) * 100}%` }} /></div></li>
                ))}
              </ul>
            </Panel>
          </div>
          <Panel title="Top pages" className="h-auto">
            <ul className="flex flex-col gap-3">
              {i.top.map((t) => (
                <li key={t.path}><div className="flex justify-between gap-3 text-sm"><span className="min-w-0 truncate">{t.title} <span className={M}>{t.path}</span></span><span className="tabular-nums">{t.views.toLocaleString("en-IN")}{t.enquiries ? <span className={M}> · {t.enquiries} enquir{t.enquiries === 1 ? "y" : "ies"}</span> : null}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-white/[0.06]"><div className="h-2 rounded-full bg-white/50" style={{ width: `${(t.views / top) * 100}%` }} /></div></li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </>
  );
}
