import Link from "next/link";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { StateChip } from "@smw/ui/comm/StateChip";
import { dateTime } from "@smw/ui/format";
import { REPORT_CATEGORIES, REPORT_CHIP } from "../constants";
import { SafeguardService, type ReportDetail } from "../safeguard";
import { UnreadFallback } from "./empty";
import { HandleForm, ReviewForm } from "./safeguard-forms";

export const metadata = { title: "Concern" };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const svc = new SafeguardService(await requireCtx());
  let r: ReportDetail;
  try { r = await svc.report((await params).id); } catch (e) { if (e instanceof NotFoundError) return <UnreadFallback title="That concern was not found" text="It may not be yours to open." href="/app/safeguarding" label="Back to concerns" />; throw e; }
  return (
    <>
      <PageHeader eyebrow="Safeguarding" title={REPORT_CATEGORIES[r.category] ?? r.category} description={`${r.subject}${r.studentName ? `, about ${r.studentName}` : ""}. Reported by ${r.reporter}, ${dateTime(r.createdAt)}.`}
        actions={<><StateChip kind="report" state={REPORT_CHIP[r.state]} /><Link href="/app/safeguarding" className="text-sm text-[var(--ds-on-surface-muted)] underline">All concerns</Link></>} />
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="What was reported">
          <p className="whitespace-pre-wrap text-sm text-[var(--ds-on-surface)]">{r.note}</p>
          <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">{r.aboutMessage ? "About one message. " : "About the conversation. "}The concern names: {r.about.length ? r.about.join(", ") : "no one else"}. They cannot see it.</p>
          {r.outcome ? <p className="mt-3 border-t border-white/10 pt-3 text-sm text-[var(--ds-on-surface-variant)]">Decided: {r.outcome}</p> : null}
        </Panel>
        <Panel title="Read the conversation"><ReviewForm threadId={r.threadId} reportId={r.id} /></Panel>
        <Panel title="Where it stands"><HandleForm reportId={r.id} state={r.state} outcome={r.outcome} /></Panel>
        <Panel title="Who opened this conversation">
          {r.reviews.length ? (
            <ul className="flex flex-col gap-3 text-sm">{r.reviews.map((v) => <li key={v.id}><span className="block">{v.reviewer} {v.action === "exported" ? "exported" : "opened"} it, {dateTime(v.at)}</span><span className="block text-xs text-[var(--ds-on-surface-muted)]">{v.reason}</span></li>)}</ul>
          ) : <p className="text-sm text-[var(--ds-on-surface-muted)]">Nobody has opened it yet. When you do, it shows here and in the review log.</p>}
        </Panel>
      </div>
    </>
  );
}
