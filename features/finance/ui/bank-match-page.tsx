import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Money } from "@smw/ui/finance/Money";
import { EmptyLine } from "@smw/ui/finance/States";
import { shortDate } from "@smw/ui/format";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { BankService } from "../services/bank";
import { matchBankLine } from "./actions";
import { MatchForm } from "./match-form";
import { FIELD, PILL, one, type SearchParams } from "./styles";

export const metadata = { title: "Match a bank line" };

export default async function BankMatchPage({ params, searchParams }: { params: Promise<{ id: string; lineId: string }>; searchParams: SearchParams }) {
  const [{ id, lineId }, sp, ctx] = await Promise.all([params, searchParams, requireCtx()]);
  const svc = new BankService(ctx);
  if (!svc.can("reconcile")) notFound();
  const q = one(sp.q);
  const data = await svc.candidates(lineId, { q }).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const line = data.line;
  if (line.cashAccountId !== id) notFound();
  const back = `/app/finance/banking/${id}`;
  const item = (k: { lineId: string; journalId: string; number: string; date: string; memo: string; amountPaise: number }, why?: string[]) => ({ lineId: k.lineId, number: k.number, date: k.date, memo: k.memo, amountPaise: k.amountPaise, why, journalHref: `/app/finance/journals/${k.journalId}` });
  const groups = [
    { title: "Best fits", items: data.suggestions.map((s) => item(s, s.why)) },
    { title: q ? `Entries matching "${q}"` : "Other open entries nearby", items: data.others.map((o) => item(o)) },
  ];
  return (
    <>
      <PageHeader eyebrow="Banking" title="Match a bank line" description={`${shortDate(line.date)} · ${line.description}${line.reference ? ` · ${line.reference}` : ""}`}
        actions={<Link href={back} className={PILL}>Back to the statement</Link>} />
      <p className="pb-4 text-sm text-[var(--ds-on-surface-variant)]">The bank {line.amountPaise > 0 ? "credited" : "debited"} <Money paise={Math.abs(line.amountPaise)} />. Pick the entry in the books it belongs to. For one deposit slip that covers several receipts, pick them all: they must add up to the bank amount.</p>
      <form method="get" role="search" className="flex flex-wrap items-end gap-2 pb-6">
        <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Search other entries
          <input name="q" defaultValue={q} placeholder="Number or narration" className={`${FIELD} w-64`} />
        </label>
        <button type="submit" className={PILL}>Search</button>
      </form>
      {line.matchedAt ? (
        <EmptyLine title="This line is already matched." hint="Unmatch it from the statement first if it was matched wrongly." action={<Link href={back} className={PILL}>Back to the statement</Link>} />
      ) : groups.every((g) => g.items.length === 0) ? (
        <EmptyLine title="No open entry fits." hint="Nothing in the books is waiting for this bank line. Record what the bank did instead: a charge, interest, a move between accounts or another entry." action={<Link href={back} className={PILL}>Record it from the statement</Link>} />
      ) : (
        <MatchForm bankLineId={line.id} amountPaise={line.amountPaise} groups={groups} action={matchBankLine} doneHref={back} />
      )}
    </>
  );
}
