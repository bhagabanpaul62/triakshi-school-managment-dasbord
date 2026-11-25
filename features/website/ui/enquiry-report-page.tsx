import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader, KpiRow } from "@smw/ui/shell/PageHeader";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { StatCard } from "@smw/ui/kit/StatCard";
import { Panel } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { EmptyLine } from "@smw/ui/finance/States";
import { EnquiryReportService, EnquiryService, STAGE_WORDS, type ReportQuery } from "../service";
import { EnquiryPeriod } from "./enquiry-period";

export const metadata = { title: "Enquiry reports" };

/** A number that opens the list behind it. */
const N = ({ href, children }: { href: string; children: number | string }) => <Link href={href} className="tabular-nums underline-offset-4 hover:underline">{children}</Link>;
const hours = (h: number | null) => (h === null ? "Not yet" : h < 1 ? "Under an hour" : h < 48 ? `${Math.round(h * 10) / 10} hours` : `${Math.round((h / 24) * 10) / 10} days`);

export default async function EnquiryReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new EnquiryService(ctx);
  if (!svc.can("enquiries")) return <NoAccess title="Enquiry reports are for the office." hint="Ask your school admin if you need them." />;
  const q = await searchParams;
  const query: ReportQuery = { from: q.from, to: q.to, session: q.session };
  const r = await new EnquiryReportService(ctx).summary(query);
  const csv = new URLSearchParams(Object.entries(q).flatMap(([k, v]) => (v && ["from", "to", "session"].includes(k) ? [[k, v]] : []))).toString();
  const top = r.funnel[0]?.n ?? 0, admitted = r.funnel[r.funnel.length - 1]?.n ?? 0;
  const max = Math.max(1, top);
  return (
    <>
      <PageHeader eyebrow="Enquiries" title="Enquiry reports" description="How many families asked, how far they got and where they were lost."
        actions={<><Button asChild variant="secondary" className="rounded-full"><Link href="/app/enquiries">Back to enquiries</Link></Button>
          {svc.can("pipeline") ? <Button asChild variant="secondary" className="rounded-full"><a href={`/api/enquiries/report${csv ? `?${csv}` : ""}`}>Download as a spreadsheet</a></Button> : null}</>} />
      <div className="pb-4"><EnquiryPeriod sessions={r.sessions} /></div>
      {r.total === 0 ? <EmptyLine title="No enquiries in this period." hint="Change the dates, or clear them to see everything." /> : (
        <div className="flex flex-col gap-3">
          <KpiRow>
            <StatCard label="Received" value={String(r.total)} href={`/app/enquiries?view=list&show=all&kind=admission${csv ? `&${csv}` : ""}`} />
            <StatCard label="Admitted" value={String(admitted)} meta={top ? `${Math.round((admitted / top) * 100)}% of those who asked` : undefined} href={r.funnel[r.funnel.length - 1]?.href} />
            <StatCard label="Time to first call" value={hours(r.response.medianHours)} meta="Middle value" />
            <StatCard label="Never called" value={String(r.response.never)} meta="Still open" href={r.response.neverHref} />
          </KpiRow>
          <Panel title="How far they got">
            <ol className="flex flex-col gap-2">{r.funnel.map((f) => (
              <li key={f.stage} className="grid grid-cols-[7rem_1fr_3rem] items-center gap-3 text-sm"><span>{f.label}</span>
                <span className="h-2 rounded-full bg-white/[0.06]"><span className="block h-2 rounded-full bg-[var(--ds-primary)]" style={{ width: `${(f.n / max) * 100}%` }} /></span>
                <span className="text-right"><N href={f.href}>{f.n}</N></span></li>))}</ol>
          </Panel>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Panel title={`Classes against seats, ${r.query.session ?? r.sessions[0]}`}><Table head={["Class", "Asked", "Offered or admitted", "Seats left"]} rows={r.byClass.map((c) => [<N key="a" href={c.href}>{c.className}</N>, <N key="n" href={c.href}>{c.n}</N>, <N key="t" href={c.takenHref}>{c.taken}</N>, c.seats === null ? "Not set" : c.left!])} empty="No class named yet." /></Panel>
            <Panel title="Where they came from"><Table head={["Source", "Asked", "Admitted"]} rows={r.bySource.map((s) => [<N key="a" href={s.href}>{s.source}</N>, <N key="n" href={s.href}>{s.n}</N>, <N key="d" href={s.admittedHref}>{s.admitted}</N>])} empty="No enquiries." /></Panel>
            {r.campaigns.length ? <Panel title="Campaigns"><Table head={["Campaign", "Asked", "Admitted"]} rows={r.campaigns.map((s) => [<N key="a" href={s.href}>{s.campaign ?? ""}</N>, <N key="n" href={s.href}>{s.n}</N>, <N key="d" href={s.admittedHref}>{s.admitted}</N>])} empty="" /></Panel> : null}
            <Panel title="Why they were lost"><Table head={["Reason", "Enquiries"]} rows={r.lost.map((l) => [<N key="a" href={l.href}>{l.reason}</N>, <N key="n" href={l.href}>{l.n}</N>])} empty="Nobody has been closed in this period." /></Panel>
            <Panel title="Who has the work"><Table head={["Owner", "Open", "Late", "No next step"]} rows={r.owners.map((o) => [<N key="a" href={o.href}>{o.name}</N>, <N key="n" href={o.href}>{o.open}</N>, <N key="l" href={o.lateHref}>{o.late}</N>, <N key="x" href={o.noneHref}>{o.none}</N>])} empty="Nothing is open." /></Panel>
          </div>
          <p className="text-xs text-[var(--ds-on-surface-muted)]">{STAGE_WORDS.waitlist} and closed enquiries count up to the furthest stage they reached.</p>
        </div>
      )}
    </>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: (string | number | React.ReactNode)[][]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-[var(--ds-on-surface-muted)]">{empty}</p>;
  return (
    <div className="custom-scrollbar -mx-2 relative overflow-x-auto"><table className="w-full text-sm">
      <thead><tr className="text-left font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{head.map((h, i) => <th key={h} className={`px-2 pb-2 font-normal ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j} className={`px-2 py-1.5 tabular-nums ${j ? "text-right" : ""}`}>{c}</td>)}</tr>)}</tbody></table></div>
  );
}
