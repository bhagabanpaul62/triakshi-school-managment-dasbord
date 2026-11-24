import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { Money } from "@smw/ui/finance/Money";
import { CopyValue } from "@smw/ui/finance/CopyValue";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { shortDate } from "@smw/ui/format";
import { JournalService } from "../services/journals";
import { requestReversal } from "./actions";
import { JOURNAL_KIND_LABEL, JOURNAL_KIND_TONE } from "./labels";

export const metadata = { title: "Journal entry" };
const LINK = "underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";

/** `sourceHref` is passed in by the app (apps/school/src/lib/finance-links.ts) so finance imports no other module's routes. */
export default async function JournalPage({ params, sourceHref }: { params: Promise<{ id: string }>; sourceHref: (sourceType: string, sourceId: string | null) => string | null }) {
  const { id } = await params;
  const svc = new JournalService(await requireCtx());
  if (!svc.can("read")) notFound();
  const d = await svc.get(id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const j = d.journal, source = sourceHref(j.sourceType, j.sourceId);
  const debit = d.lines.reduce((s, l) => s + l.debitPaise, 0), credit = d.lines.reduce((s, l) => s + l.creditPaise, 0);
  const undo = d.canReverse && svc.can("journal") ? (
    <FormModal title="Undo this entry" icon="book" action={requestReversal} hidden={{ id }} submitLabel="Ask to undo" trigger={{ label: "Undo this entry", variant: "secondary" }}
      description="Posts the mirror image once another person approves. This entry stays, linked to its undo."
      fields={[{ name: "reason", label: "Why is it being undone?", type: "textarea", required: true }]} />
  ) : null;

  return (
    <>
      <PageHeader eyebrow="Journal entries" title={<span className="font-mono">{j.number}</span>} description={j.memo}
        actions={<><Link href="/app/finance/journals" className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm hover:bg-white/[0.12]">All entries</Link>{undo}</>} />
      <div className="flex flex-col gap-3">
        <Panel title="Details">
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-[var(--ds-on-surface-muted)]">Date</dt><dd>{shortDate(j.date)}{j.originalDate ? <span className="block text-xs text-[var(--ds-on-surface-muted)]">Dated {shortDate(j.originalDate)}; that month is locked, so it landed here.</span> : null}</dd></div>
            <div><dt className="text-[var(--ds-on-surface-muted)]">Kind</dt><dd><ToneBadge label={JOURNAL_KIND_LABEL[j.kind]} tone={JOURNAL_KIND_TONE[j.kind] ?? "default"} /></dd></div>
            <div><dt className="text-[var(--ds-on-surface-muted)]">Made by</dt><dd>{d.createdByName ?? "The system"}</dd></div>
            <div><dt className="text-[var(--ds-on-surface-muted)]">Source</dt><dd>{source ? <Link href={source} className={LINK}>{j.sourceType}</Link> : j.sourceType}<span className="block"><CopyValue value={j.sourceKey} /></span></dd></div>
          </dl>
          {d.reverses ? <p className="mt-4 text-sm">This undoes <Link className={LINK} href={`/app/finance/journals/${d.reverses.id}`}>{d.reverses.number}</Link>.</p> : null}
          {d.reversedBy ? <p className="mt-4 text-sm">Undone by <Link className={LINK} href={`/app/finance/journals/${d.reversedBy.id}`}>{d.reversedBy.number}</Link>.</p> : null}
          {d.reversalPending ? <p className="mt-4 text-sm">An undo is waiting for approval. <Link className={LINK} href="/app/finance/approvals">Open approvals</Link>.</p> : null}
          {!d.canReverse && !d.reversedBy && !d.reversalPending && !d.reverses ? <p className="mt-4 text-xs text-[var(--ds-on-surface-muted)]">Made by another module. Undo the document that made it (cancel the invoice, reverse the receipt) and this entry is undone with it.</p> : null}
        </Panel>
        <Panel title="Lines">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="text-left font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]"><th className="py-2 font-normal">Account</th><th className="py-2 font-normal">Party</th><th className="py-2 text-right font-normal">Debit</th><th className="py-2 text-right font-normal">Credit</th></tr></thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.id} className="align-top">
                    <td className="py-2"><Link className={LINK} href={`/app/finance/accounts/${l.accountId}`}><span className="text-[var(--ds-on-surface-muted)]">{l.code}</span> {l.account}</Link>{l.costCentre ? <span className="block text-xs text-[var(--ds-on-surface-muted)]">{l.costCentre}</span> : null}</td>
                    <td className="py-2 text-[var(--ds-on-surface-variant)]">{l.partyType ?? "-"}</td>
                    <td className="py-2 text-right"><Money paise={l.debitPaise || null} fixed /></td>
                    <td className="py-2 text-right"><Money paise={l.creditPaise || null} fixed /></td>
                  </tr>
                ))}
                <tr><td className="pt-3 font-medium" colSpan={2}>Total</td><td className="pt-3 text-right"><Money paise={debit} fixed /></td><td className="pt-3 text-right"><Money paise={credit} fixed /></td></tr>
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}
