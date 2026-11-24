import Link from "next/link";
import { canApprove } from "@smw/feature-finance/approvals";
import type { Ctx } from "@smw/feature-kit";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { buttonVariants } from "@smw/ui/ui/button";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { StatusTrack, type TrackStep } from "@smw/ui/finance/StatusTrack";
import { Money } from "@smw/ui/finance/Money";
import { ConfirmMoney } from "@smw/ui/finance/ConfirmMoney";
import { shortDate } from "@smw/ui/format";
import { BillService } from "../service";
import { cancelBill, submitBill, withdrawBill } from "./actions";
import { Notice, can, JournalLink } from "./shared";
import { PeekFrame } from "./peek-frame";

type Detail = Awaited<ReturnType<BillService["get"]>>;

function track(d: Detail): TrackStep[] {
  const s = d.bill.status, paid = d.state === "paid", ap = d.approval;
  const approvalState = s === "rejected" ? "failed" : s === "pending" ? "now" : s === "draft" && !ap ? "todo" : s === "approved" ? "done" : "todo";
  return [
    { label: "Entered", state: s === "cancelled" ? "failed" : "done", at: d.bill.billDate },
    { label: s === "rejected" ? "Not approved" : "Approval", state: approvalState },
    { label: "Posted", state: d.journalId ? "done" : "todo" },
    { label: paid ? "Paid" : d.bill.paidPaise ? "Part paid" : "Payment", state: paid ? "done" : d.bill.paidPaise ? "now" : "todo" },
  ];
}

/** One bill beside the list: where it stands, what to do next, and its links to vendor, payments and the ledger. */
export default async function BillPeek({ ctx, id }: { ctx: Ctx; id: string }) {
  let d: Detail;
  try { d = await new BillService(ctx).get(id); } catch { return <PeekFrame param="bill" title="Bill not found"><Notice tone="danger" action={{ href: "/app/expenses/bills", label: "Back to bills" }}>This bill does not exist, or it belongs to another school.</Notice></PeekFrame>; }
  const { bill, approval: ap } = d, manage = can(ctx, "manage");
  return (
    <PeekFrame param="bill" title={`Bill ${bill.billNo}`} description={d.vendor.name}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StateBadge state={d.state} />
          <Link href={`/app/expenses/vendors/${bill.vendorId}`} className="text-sm underline underline-offset-4">{d.vendor.name}</Link>
        </div>
        <StatusTrack steps={track(d)} label="Where this bill stands" />

        {bill.status === "rejected" ? <Notice tone="danger" action={manage ? { href: `/app/expenses/bills/${bill.id}/edit`, label: "Edit and resend" } : undefined}>Not approved{ap?.decidedByName ? ` by ${ap.decidedByName}` : ""}: {ap?.note ?? "no reason was written"}</Notice> : null}
        {bill.status === "pending" ? (
          <Notice tone="info" action={canApprove(ctx) ? { href: "/app/finance/approvals", label: "Open approvals" } : undefined}>
            Waiting for {ap?.waitingFor.length ? ap.waitingFor.join(" or ") : "an admin"} to approve. {ap?.reason}
          </Notice>
        ) : null}
        {bill.status === "draft" && !d.vendor.hasBank ? <Notice tone="warning" action={manage ? { href: `/app/expenses/vendors/${bill.vendorId}?next=${encodeURIComponent(`/app/expenses/bills?bill=${bill.id}`)}`, label: "Add bank details" } : undefined}>{d.vendor.name} has no bank or UPI details yet. You can approve the bill, but paying by bank needs them.</Notice> : null}

        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-[var(--ds-on-surface-muted)]"><th className="py-2 font-normal">Line</th><th className="py-2 font-normal">Account</th><th className="py-2 text-right font-normal">Amount</th></tr></thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id} className="border-t border-white/[0.06]"><td className="py-2">{l.label}</td><td className="py-2 text-[var(--ds-on-surface-muted)]">{l.accountName}{l.centreName ? ` · ${l.centreName}` : ""}</td><td className="py-2 text-right"><Money paise={l.amountPaise} /></td></tr>
            ))}
          </tbody>
        </table>
        <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-[var(--ds-on-surface-muted)]">Bill total</dt><dd className="text-right"><Money paise={bill.grossPaise} /></dd>
          {bill.tdsPaise ? <><dt className="text-[var(--ds-on-surface-muted)]">Tax withheld (TDS)</dt><dd className="text-right"><Money paise={-bill.tdsPaise} /></dd></> : null}
          <dt>To pay</dt><dd className="text-right"><Money paise={d.netPaise} /></dd>
          <dt className="text-[var(--ds-on-surface-muted)]">Paid</dt><dd className="text-right"><Money paise={bill.paidPaise} /></dd>
          <dt className="font-medium">Still owed</dt><dd className="text-right font-medium"><Money paise={d.openPaise} /></dd>
        </dl>
        <p className="text-xs text-[var(--ds-on-surface-muted)]">Dated {shortDate(bill.billDate)}, due {shortDate(bill.dueDate)}.{bill.note ? ` ${bill.note}` : ""}</p>

        {d.fileUrl ? (
          <div className="flex flex-col gap-2">
            <a href={d.fileUrl} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-4">Open the attached file ({bill.fileName})</a>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {/\.(png|jpe?g)$/i.test(bill.fileName ?? "") ? <img src={d.fileUrl} alt={`Attached copy of bill ${bill.billNo}`} className="max-h-72 rounded-2xl object-contain" /> : null}
          </div>
        ) : <p className="text-xs text-[var(--ds-on-surface-muted)]">No file attached.{manage && (bill.status === "draft" || bill.status === "rejected") ? " Edit the bill to add a photo or PDF." : ""}</p>}

        <section aria-label="Payments">
          <h3 className="mb-2 text-sm font-medium">Payments</h3>
          {d.payments.length ? (
            <ul className="divide-y divide-white/[0.06] text-sm">
              {d.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/app/expenses/payments?q=${encodeURIComponent(p.number)}`} className="underline underline-offset-4">{p.number}</Link>
                  <span className="text-[var(--ds-on-surface-muted)]">{shortDate(p.date)} · {p.method.replace(/_/g, " ")}</span>
                  {p.status === "reversed" ? <StateBadge state="reversed" /> : null}
                  <Money paise={p.amountPaise} />
                  <JournalLink id={p.journalId} />
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-[var(--ds-on-surface-muted)]">Nothing paid yet.</p>}
        </section>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
          {manage && bill.status === "draft" ? <>
            <Link href={`/app/expenses/bills/${bill.id}/edit`} className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Edit</Link>
            <ActionButton label="Send for approval" variant="default" action={submitBill} values={{ id: bill.id }} />
          </> : null}
          {manage && bill.status === "pending" ? <ActionButton label="Withdraw" action={withdrawBill} values={{ id: bill.id }} confirm={{ title: "Take this bill back?", body: "It returns to draft and the approval request closes. You can change it and send it again.", confirmLabel: "Withdraw" }} /> : null}
          {manage && bill.status === "approved" && d.openPaise > 0 ? <Link href={`/app/expenses/payments/new?bills=${bill.id}`} className={buttonVariants({ className: "rounded-full" })}>Pay this bill</Link> : null}
          {manage && ["draft", "rejected", "pending", "approved"].includes(bill.status) && bill.paidPaise === 0 ? <ConfirmMoney label="Cancel bill" title="Cancel this bill" action={cancelBill} values={{ id: bill.id }} amountPaise={bill.grossPaise} danger consequence={bill.status === "approved" ? "The entry in the books is undone with a mirror entry." : "Nothing was posted, so nothing is undone."} confirmLabel="Cancel bill" successMessage="Bill cancelled" /> : null}
          <JournalLink id={d.journalId} />
        </div>
        <p className="text-xs text-[var(--ds-on-surface-muted)]">
          {bill.status === "cancelled" ? "This bill is cancelled. Enter it again as a new bill if it was cancelled by mistake."
            : bill.paidPaise > 0 ? "A paid bill cannot be edited. To undo it, reverse its payments from the Payments page (an approver confirms), then cancel the bill."
            : bill.status === "approved" ? "An approved bill cannot be edited. Cancel it and enter it again if something is wrong." : "Drafts can be edited until they are sent for approval."}
        </p>
      </div>
    </PeekFrame>
  );
}
