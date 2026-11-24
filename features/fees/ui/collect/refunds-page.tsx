import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { rupees } from "@smw/feature-kit/money";
import { listQueryFrom } from "@smw/feature-kit";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { buttonVariants } from "@smw/ui/ui/button";
import { EmptyLine } from "@smw/ui/finance/States";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { DeskService, RefundService } from "../../service";
import { FeesLookup } from "../lookups";
import { proposeRefund, resubmitRefund, settleUpLeaving, withdrawRefund } from "../collect-actions";
import { StudentPicker } from "./student-picker";
import { DeskNav, H2, NoAccess, Notice, NoticeLink, Ref, SECTION, can, day, one, type Search } from "./shared";

export const metadata = { title: "Refunds" };

const METHODS = [["cash", "Cash"], ["cheque", "Cheque"], ["upi", "UPI"], ["bank_transfer", "Bank transfer"]].map(([value, label]) => ({ value: value!, label: label! }));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RefundsPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "read")) return <NoAccess what="Refunds" who="accountants, admins and auditors" />;
  const sp = await searchParams;
  const studentId = UUID.test(one(sp.student)) ? one(sp.student) : "";
  const refunds = new RefundService(ctx);
  const [page, bal, picked, config] = await Promise.all([refunds.list({ ...listQueryFrom(sp), pageSize: 50 }), studentId ? refunds.balances(studentId) : null, studentId ? new FeesLookup(ctx).studentOption(studentId) : null, new DeskService(ctx).config()]);
  const methodFields = [{ name: "method", label: "Pay back by", type: "select" as const, required: true, options: METHODS }, { name: "reference", label: "Reference or cheque no", type: "text" as const }];

  return (
    <>
      <PageHeader eyebrow="Fees" title="Refunds" description="Money going back to a family from an advance or a deposit. Someone else approves it, then it is paid and a voucher is made." />
      <DeskNav ctx={ctx} current="/app/fees/refunds" />
      {config.banks.length ? null : <Notice tone="warning" action={can(ctx, "setup") ? <NoticeLink href="/app/finance/accounts?next=/app/fees/refunds">Add a bank account</NoticeLink> : undefined}>There is no bank account yet. A refund paid by transfer, cheque or UPI needs one; a cash refund does not.{can(ctx, "setup") ? "" : " Ask an admin to add it."}</Notice>}
      {can(ctx, "collect") ? (
        <section className={`${SECTION} mb-6`} aria-label="New refund">
          <h2 className={H2}>New refund</h2>
          <div className="grid gap-4 md:grid-cols-[minmax(0,360px)_1fr] md:items-end">
            <StudentPicker path="/app/fees/refunds" initial={picked ? { id: studentId, label: picked.label } : undefined} />
            {bal && picked ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span>Advance <Money paise={bal.advancePaise} size="md" /></span><span>Deposit <Money paise={bal.depositPaise} size="md" /></span>
                {bal.advancePaise + bal.depositPaise > 0 ? (
                  <FormModal title={`Refund for ${picked.label}`} description="Goes for approval before any money moves." icon="money" action={proposeRefund} hidden={{ studentId }} submitLabel="Ask for approval" trigger={{ label: "New refund", plus: false }}
                    summary={`Can refund up to ${rupees(bal.advancePaise)} advance and ${rupees(bal.depositPaise)} deposit.`}
                    fields={[{ name: "source", label: "Take it from", type: "select", required: true, options: [{ value: "advance", label: "Advance" }, { value: "deposit", label: "Security deposit" }] }, { name: "amountPaise", label: "Amount", type: "money", required: true }, ...methodFields, { name: "reason", label: "Why?", type: "textarea", required: true, wide: true }]} />
                ) : <span className="text-[var(--ds-on-surface-muted)]">Nothing to refund: no advance or deposit is held.</span>}
                {can(ctx, "concede") ? (
                  <FormModal title={`${picked.label} is leaving`} description="The advance, then the deposit, go against what is owed. Whatever is left is asked back for approval." icon="users" action={settleUpLeaving} hidden={{ studentId }} submitLabel="Settle up" trigger={{ label: "Student is leaving", variant: "ghost", plus: false }}
                    fields={[...methodFields.map((f) => ({ ...f, name: f.name })), { name: "reason", label: "Why?", type: "text", required: true, placeholder: "Transfer certificate issued" }]} />
                ) : null}
              </div>
            ) : <p className="text-sm text-[var(--ds-on-surface-muted)]">Pick a student to see what can be refunded.</p>}
          </div>
        </section>
      ) : null}

      <section className={SECTION} aria-label="Refund register">
        <h2 className={H2}>Register</h2>
        {page.rows.length === 0 ? <EmptyLine title="No refunds yet." hint="A refund is asked for from a student's advance or deposit." /> : (
          <ul className="flex flex-col gap-3">
            {page.rows.map((r) => {
              const a = r.approval;
              return (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-white/[0.04] p-4 text-sm">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2"><Ref href={`/app/fees/students/${r.studentId}`}>{r.studentName}</Ref><StateBadge state={r.status} /><span className="text-xs text-[var(--ds-on-surface-muted)]">{r.admissionNo} · {r.classLabel} · {r.number ?? "no voucher yet"} · {r.source === "advance" ? "advance" : "deposit"} · asked {day(r.createdAt)}</span></p>
                    <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">{r.reason}</p>
                    {r.status === "pending" ? <p className="mt-1 text-xs text-[var(--ds-color-warning-400)]">Waiting for {a?.waitingFor.length ? a.waitingFor.join(" or ") : "an admin"} to approve. <Link href="/app/finance/approvals" className="underline underline-offset-4">See approvals</Link></p> : null}
                    {r.status === "rejected" ? <p className="mt-1 text-xs text-[var(--ds-color-danger-400)]">Not approved{a?.decidedByName ? ` by ${a.decidedByName}` : ""}: {a?.note ?? "no reason was written"}. Edit it and send it again, or leave it.</p> : null}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <Money paise={r.amountPaise} size="lg" />
                    {r.status === "approved" ? <Link href={`/app/fees/refunds/${r.id}/voucher`} target="_blank" className={buttonVariants({ variant: "secondary", size: "sm", className: "rounded-full" })}>Voucher</Link> : null}
                    {r.status === "pending" && can(ctx, "collect") ? <ActionButton action={withdrawRefund} values={{ id: r.id }} label="Withdraw" variant="ghost" /> : null}
                    {r.status === "rejected" && can(ctx, "collect") ? (
                      <FormModal title="Send the refund again" icon="money" action={resubmitRefund} hidden={{ id: r.id }} submitLabel="Send again" trigger={{ label: "Edit and send again", variant: "secondary", size: "sm", plus: false }}
                        values={{ source: r.source, amountPaise: r.amountPaise, method: r.method, reference: r.reference, reason: r.reason }}
                        fields={[{ name: "source", label: "Take it from", type: "select", required: true, options: [{ value: "advance", label: "Advance" }, { value: "deposit", label: "Security deposit" }] }, { name: "amountPaise", label: "Amount", type: "money", required: true }, ...methodFields, { name: "reason", label: "Why?", type: "textarea", required: true, wide: true }]} />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
