import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { rupees } from "@smw/feature-kit/money";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { buttonVariants } from "@smw/ui/ui/button";
import { cn } from "@smw/ui/utils";
import { CopyValue } from "@smw/ui/finance/CopyValue";
import { EmptyLine } from "@smw/ui/finance/States";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { DeskService, SlipService } from "../../service";
import { rejectSlip, verifySlip } from "../collect-actions";
import { DeskNav, NoAccess, Notice, NoticeLink, Ref, can, day, one, type Search } from "./shared";

export const metadata = { title: "UPI slips" };

export default async function SlipsPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "collect")) return <NoAccess what="UPI slips" who="cashiers, accountants and admins" />;
  const history = one((await searchParams).tab) === "history";
  const slips = new SlipService(ctx);
  const [waiting, verified, rejected, config] = await Promise.all([
    slips.list({ filters: { status: "submitted" }, pageSize: 100 }), history ? slips.list({ filters: { status: "verified" }, pageSize: 50 }) : null, history ? slips.list({ filters: { status: "rejected" }, pageSize: 50 }) : null, new DeskService(ctx).config(),
  ]);
  const rows = history ? [...verified!.rows, ...rejected!.rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) : waiting.rows;
  const extras = await slips.extras(rows);

  return (
    <>
      <PageHeader eyebrow="Fees" title="UPI slips" description="Families say they paid by UPI. Check the money in the bank, then verify: the receipt is made for them." />
      <DeskNav ctx={ctx} current="/app/fees/slips" />
      {config.upiOn && !config.upi ? <Notice tone="warning" action={<NoticeLink href="/app/finance/accounts?next=/app/fees/slips">Add the UPI ID</NoticeLink>}>UPI is on, but no account has a UPI ID yet, so families have no code to pay to.</Notice> : null}
      {!config.upiOn ? <Notice tone="warning" action={<NoticeLink href="/app/finance/settings?next=/app/fees/slips">Turn on UPI</NoticeLink>}>UPI payments are off, so families cannot send slips. Turn it on in the finance settings and add the school's UPI ID.</Notice> : null}
      <div role="tablist" aria-label="Slips" className="mb-4 flex gap-1">
        {[["", `Waiting (${waiting.total})`], ["history", "History"]].map(([v, label]) => (
          <Link key={v} role="tab" aria-selected={(v === "history") === history} href={v ? `/app/fees/slips?tab=${v}` : "/app/fees/slips"}
            className={cn("rounded-full px-4 py-2 text-sm hover:bg-white/[0.06]", (v === "history") === history ? "bg-white/[0.1]" : "text-[var(--ds-on-surface-muted)]")}>{label}</Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyLine title={history ? "No slips decided yet." : "No slips are waiting."} hint={history ? undefined : "When a family reports a UPI payment it shows up here for you to verify."} action={history ? undefined : <Link href="/app/fees/collect" className={buttonVariants({ className: "rounded-full" })}>Collect fees</Link>} />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {rows.map((s) => {
            const x = extras[s.id]!;
            const open = x.bills.reduce((t, b) => t + b.openPaise, 0);
            return (
              <li key={s.id} className="flex flex-col gap-3 rounded-3xl bg-[var(--ds-surface-container-low)] p-5 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium"><Ref href={`/app/fees/students/${s.studentId}`}>{s.studentName}</Ref> <span className="text-xs font-normal text-[var(--ds-on-surface-muted)]">{s.admissionNo}</span></p>
                    <p className="mt-0.5 text-xs text-[var(--ds-on-surface-muted)]">Paid on {day(s.paidOn)} · sent {day(s.createdAt)}</p>
                  </div>
                  <div className="text-right"><Money paise={s.amountPaise} size="xl" /><div className="mt-1"><StateBadge state={s.status} /></div></div>
                </div>
                <p className="flex flex-wrap items-center gap-2">UTR <CopyValue value={s.utr} label="UTR" maxWidth="26ch" /></p>
                <div>
                  <p className="mb-1 text-xs text-[var(--ds-on-surface-muted)]">Bills it names</p>
                  <ul className="flex flex-col gap-1">{x.bills.map((b) => <li key={b.id} className="flex justify-between gap-3"><Ref href={`/app/fees/invoices/${b.id}`}>{b.label}</Ref><span className="text-xs text-[var(--ds-on-surface-muted)]">{b.number} · <Money paise={b.openPaise} size="sm" /> open</span></li>)}</ul>
                  {s.status === "submitted" && s.amountPaise !== open ? <p className="mt-1 text-xs text-[var(--ds-color-warning-400)]">{s.amountPaise > open ? `${rupees(s.amountPaise - open)} more than these bills need: the extra is kept as advance.` : `${rupees(open - s.amountPaise)} less than these bills need: they are part paid, oldest first.`}</p> : null}
                </div>
                {s.status === "submitted" ? (
                  <div className="rounded-2xl bg-white/[0.04] p-3">
                    <p className="mb-1 text-xs text-[var(--ds-on-surface-muted)]">Bank statement</p>
                    {x.hints.length ? (
                      <ul className="flex flex-col gap-1">{x.hints.map((h, i) => <li key={i} className="flex justify-between gap-3 text-xs"><span className="min-w-0 truncate" title={h.description}>{day(h.date)} · {h.description}</span><span className="shrink-0"><Money paise={h.amountPaise} size="sm" tone={h.why === "utr" ? "success" : "default"} /> {h.why === "utr" ? "UTR matches" : "same amount"}{h.matched ? ", already matched" : ""}</span></li>)}</ul>
                    ) : <p className="text-xs text-[var(--ds-on-surface-variant)]">No bank line looks like this yet. If a statement has not been imported, check your banking app before you verify.</p>}
                  </div>
                ) : null}
                {x.fileUrl ? <a href={x.fileUrl} target="_blank" rel="noopener noreferrer" className="w-fit text-xs underline underline-offset-4">Open the screenshot the family sent</a> : <p className="text-xs text-[var(--ds-on-surface-muted)]">No screenshot was attached.</p>}
                {s.status === "submitted" ? (
                  <div className="mt-1 flex flex-wrap gap-2">
                    <ActionButton action={verifySlip} values={{ id: s.id }} label="Verify and make receipt" variant="default" successMessage="Verified. The receipt is made."
                      confirm={{ title: "Verify this payment?", body: `Only do this once ${rupees(s.amountPaise)} with UTR ${s.utr} is in the bank. A receipt is made and sent to the family.`, confirmLabel: "Verify" }} />
                    <FormModal title="Reject this slip" description="The family sees your reason and can send it again with the right details." icon="clock" action={rejectSlip} hidden={{ id: s.id }} submitLabel="Reject"
                      trigger={{ label: "Reject", variant: "ghost", plus: false }} fields={[{ name: "reason", label: "Why?", type: "textarea", required: true, placeholder: "For example: no payment of this amount with this UTR in the bank" }]} />
                  </div>
                ) : s.status === "verified" && s.receiptId ? <p><Ref href={`/app/fees/receipts/${s.receiptId}`}>Open the receipt</Ref></p> : s.status === "rejected" ? <p className="text-[var(--ds-color-danger-400)]">Rejected: {s.reason}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
