import Link from "next/link";
import { allows } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import financeFeature from "@smw/feature-finance/feature";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { buttonVariants } from "@smw/ui/ui/button";
import { ConfirmMoney } from "@smw/ui/finance/ConfirmMoney";
import { DocumentPaper } from "@smw/ui/finance/DocumentPaper";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { StatusTrack, type TrackStep } from "@smw/ui/finance/StatusTrack";
import { METHOD_LABEL } from "../../constants";
import { ReceiptService } from "../../service";
import { requestReversal, withdrawReversal } from "../collect-actions";
import { BackLink, H2, NoAccess, Notice, Ref, SECTION, can, day } from "./shared";

export const metadata = { title: "Receipt" };

/** What a person sees of one receipt: the paper, where it stands, what it paid, and the one legal way to undo it. */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "read") && !can(ctx, "self")) return <NoAccess what="Receipts" who="the school's accounts team and families" />;
  const { id } = await params;
  const staff = can(ctx, "read");
  const receipts = new ReceiptService(ctx);
  const [got, doc] = await Promise.all([receipts.get(id), receipts.document(id)]);
  const { receipt: r, methods, cheque, allocations, journalId, collectedByName, prints, reversal: ask } = got;
  const live = r.status === "valid" || r.status === "clearing";
  const canDecide = allows(ctx, financeFeature, "approve");
  const back = staff ? { href: "/app/fees/receipts", label: "All receipts" } : { href: "/app/fees", label: "My fees" };

  const steps: TrackStep[] = cheque
    ? [{ label: "Received", state: "done", at: r.date }, { label: "Deposited", state: cheque.status === "received" ? "now" : "done", at: cheque.depositedOn },
      cheque.status === "bounced" ? { label: "Bounced", state: "failed", at: cheque.bouncedOn } : { label: "Cleared", state: cheque.status === "cleared" ? "done" : "todo", at: cheque.clearedOn }]
    : [{ label: "Received", state: "done", at: r.date }, { label: "In the books", state: journalId || !staff ? "done" : "todo" }];
  if (r.status === "reversed") steps.push({ label: "Reversed", state: "failed", at: r.reversedAt?.toISOString() ?? null });
  else if (ask?.status === "pending") steps.push({ label: "Reversal asked", state: "now", at: undefined });

  const allocated = allocations.filter((a) => !a.undoneAt);
  const nextAction = r.status === "bounced" ? { href: `/app/fees/collect?student=${r.studentId}`, label: "Collect again" } : r.status === "reversed" ? { href: `/app/fees/collect?student=${r.studentId}`, label: "Collect a new receipt" } : null;

  return (
    <>
      <BackLink href={back.href}>{back.label}</BackLink>
      <PageHeader eyebrow="Receipt" title={<span className="flex flex-wrap items-center gap-3"><span className="font-mono">{r.number}</span><StateBadge state={r.status} /></span>}
        description={<>{day(r.date)} · for {staff ? <Ref href={`/app/fees/students/${r.studentId}`}>{r.snapshot.studentName}</Ref> : r.snapshot.studentName} · {r.snapshot.classLabel}{collectedByName ? ` · taken by ${collectedByName}` : ""}</>}
        actions={<>
          <Link href={`/app/fees/receipts/${r.id}/pdf`} target="_blank" className={buttonVariants({ className: "rounded-full" })}>Print receipt</Link>
          {nextAction && can(ctx, "collect") ? <Link href={nextAction.href} className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>{nextAction.label}</Link> : null}
        </>} />
      <div className={`${SECTION} mb-4`}><StatusTrack steps={steps} label="Receipt progress" /></div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-x-auto rounded-3xl bg-[var(--ds-surface-container-low)] p-3">
          <DocumentPaper config={doc.config} data={doc.data} kind="receipt" mode="screen" />
        </div>

        <div className="flex flex-col gap-4">
          {ask?.status === "pending" ? (
            <Notice tone="warning" action={can(ctx, "collect") ? <ActionButton action={withdrawReversal} values={{ id: r.id }} label="Withdraw" variant="secondary" /> : undefined}>
              Reversal asked by {ask.requestedByName ?? "someone"}: {ask.reason}. It waits for {ask.waitingFor.length ? ask.waitingFor.join(" or ") : "an admin who can approve"}.{" "}
              {canDecide ? <Link href="/app/finance/approvals" className="underline underline-offset-4">Decide it</Link> : <Link href="/app/finance/approvals" className="underline underline-offset-4">See the request</Link>}
            </Notice>
          ) : null}
          {ask?.status === "rejected" && live ? <Notice tone="danger">The last reversal request was not approved{ask.note ? `: ${ask.note}` : ""}. You can ask again with a better reason.</Notice> : null}
          {r.status === "reversed" ? <Notice tone="info" action={can(ctx, "collect") ? <Link href={`/app/fees/collect?student=${r.studentId}`} className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Collect again</Link> : undefined}>Reversed: {r.reverseReason}. The receipt keeps its number, and the bills it paid are open again.</Notice> : null}

          <section className={SECTION} aria-label="What it paid">
            <h2 className={H2}>What it paid</h2>
            {allocated.length ? (
              <ul className="flex flex-col gap-2 text-sm">
                {allocated.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3">
                    <span className="min-w-0">{staff ? <Ref href={`/app/fees/invoices/${a.invoiceId}`}>{a.invoiceLabel}</Ref> : a.invoiceLabel}<span className="block text-xs text-[var(--ds-on-surface-muted)]">{a.invoiceNumber ?? ""} · {a.line}</span></span>
                    <Money paise={a.amountPaise} size="sm" />
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-[var(--ds-on-surface-muted)]">{r.status === "reversed" || r.status === "bounced" ? "Nothing now: the bills were reopened." : "Nothing was applied to a bill."}</p>}
            {r.advancePaise ? <p className="mt-3 flex justify-between text-sm"><span>Kept as advance</span><Money paise={r.advancePaise} size="sm" /></p> : null}
          </section>

          <section className={SECTION} aria-label="How it was paid">
            <h2 className={H2}>How it was paid</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {methods.map((m) => <li key={m.id} className="flex justify-between gap-3"><span>{METHOD_LABEL[m.method]}{m.reference ? <span className="text-[var(--ds-on-surface-muted)]"> · {m.reference}</span> : null}</span><Money paise={m.amountPaise} size="sm" /></li>)}
              <li className="flex justify-between border-t border-white/[0.06] pt-2 font-medium"><span>Total</span><Money paise={r.amountPaise} size="sm" /></li>
            </ul>
            {cheque ? <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">Cheque {cheque.chequeNo}, {cheque.bank}, dated {day(cheque.chequeDate)}. {staff && can(ctx, "collect") ? <Link href="/app/fees/cheques" className="underline underline-offset-4">Open the cheque board</Link> : null}</p> : null}
            {r.note ? <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">Note: {r.note}</p> : null}
          </section>

          {staff ? (
            <section className={SECTION} aria-label="Records">
              <h2 className={H2}>Records</h2>
              <ul className="flex flex-col gap-2 text-sm">
                <li>Ledger entry: {journalId ? <Link href={`/app/finance/journals/${journalId}`} className="underline underline-offset-4">Open the journal entry</Link> : <span className="text-[var(--ds-on-surface-muted)]">not posted</span>}</li>
                <li>Student: <Ref href={`/app/fees/students/${r.studentId}`}>{r.snapshot.studentName}</Ref></li>
                <li className="text-[var(--ds-on-surface-muted)]">Printed {prints.length} time{prints.length === 1 ? "" : "s"}{prints.length ? ": " + prints.map((p) => `${p.copyNo === 1 ? "original" : `copy ${p.copyNo}`} by ${p.by ?? "someone"} on ${day(p.at)}`).join("; ") : ". The first print is the original."}</li>
              </ul>
            </section>
          ) : null}

          {can(ctx, "collect") ? (
            <section className={SECTION} aria-label="Undo this receipt" id="reverse">
              <h2 className={H2}>Made a mistake?</h2>
              {live && ask?.status !== "pending" ? (
                <>
                  <p className="mb-3 text-sm text-[var(--ds-on-surface-variant)]">A receipt is never edited or deleted. Ask for a reversal: someone else approves it, the bills open again, and this receipt keeps its number.</p>
                  <ConfirmMoney action={requestReversal} values={{ id: r.id }} label="Ask for reversal" title={`Reverse receipt ${r.number}`} amountPaise={r.amountPaise} final={false} confirmLabel="Send for approval" danger
                    consequence="Nothing changes until it is approved. The bills this receipt paid reopen, and the money is taken back in the books." reason={{ label: "Why is this receipt wrong?" }} />
                </>
              ) : <p className="text-sm text-[var(--ds-on-surface-muted)]">{r.status === "reversed" ? "Already reversed. To take the money again, collect a new receipt." : r.status === "bounced" ? "The cheque bounced and the bills are open again. Collect again to take the money." : "A reversal is already waiting for approval."}</p>}
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}
