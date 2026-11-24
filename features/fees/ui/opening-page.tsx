import { requireCtx } from "@smw/runtime";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { shortDate } from "@smw/ui/format";
import { OpeningImport } from "../opening";
import { withdrawOpening, resendOpening } from "./actions";
import { OpeningForm } from "./opening-form";
import { BackLink, NoAccess, can } from "./shared";
import { CARD, H3, MUTED } from "./styles";

export const metadata = { title: "Opening balances" };

export default async function OpeningPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "setup")) return <NoAccess what="Opening balances" who="accountants and admins" home="/app/fees" />;
  const batches = await new OpeningImport(ctx).batches();
  return (
    <>
      <BackLink href="/app/fees/invoices">Bills</BackLink>
      <PageHeader eyebrow="Fees" title="Opening balances" description="Bring in what families owe, and the advance and deposit they hold, from the system you used before. An approver confirms before anything is posted." />
      <OpeningForm />
      <section className={`${CARD} mt-6`} aria-label="Earlier sheets">
        <h2 className={H3}>Sheets sent</h2>
        {batches.length ? (
          <ul className="divide-y divide-white/[0.06] text-sm">
            {batches.map((b) => {
              const a = b.approval;
              return (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="min-w-0"><span className="block">{b.fileName}</span>
                    <span className={`${MUTED} block`}>{shortDate(b.createdAt)} · {b.totals.students} students · dues <Money paise={b.totals.duesPaise} size="sm" /></span>
                    {b.status === "pending" ? <span className="block text-[var(--ds-color-warning-400)]">Waiting for {a?.waitingFor.join(" or ") || "an admin"} to approve.</span> : null}
                    {b.status === "rejected" ? <span className="block text-[var(--ds-color-danger-400)]">Not approved{a?.decidedByName ? ` by ${a.decidedByName}` : ""}: {a?.note ?? "no reason was written"}</span> : null}</span>
                  <span className="flex items-center gap-2"><StateBadge state={b.status} />
                    {b.status === "pending" ? <ActionButton label="Withdraw" variant="ghost" action={withdrawOpening} values={{ id: b.id }} confirm={{ title: "Take this sheet back?", body: "Nothing was posted. You can send it again later.", confirmLabel: "Withdraw" }} /> : null}
                    {b.status === "rejected" ? <ActionButton label="Send again" action={resendOpening} values={{ id: b.id }} /> : null}</span>
                </li>
              );
            })}
          </ul>
        ) : <p className={MUTED}>No sheet sent yet.</p>}
      </section>
    </>
  );
}
