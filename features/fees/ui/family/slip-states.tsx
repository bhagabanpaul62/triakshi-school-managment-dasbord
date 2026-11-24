import Link from "next/link";
import { buttonVariants } from "@smw/ui/ui/button";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { day } from "../collect/shared";
import type { FamilyData } from "./family-data";

/** What happened to each "I have paid" report: waiting, verified with its receipt, or rejected with the reason and a way to send it again. */
export function SlipStates({ kids }: { kids: FamilyData["kids"] }) {
  const slips = kids.flatMap((k) => k.account.slips.map((s) => ({ ...s, kid: k.name }))).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 8);
  if (!slips.length) return null;
  return (
    <ul className="flex flex-col gap-2" aria-label="Your payment reports">
      {slips.map((s) => (
        <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-white/[0.04] p-3 text-sm">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2"><StateBadge state={s.status} /> UTR {s.utr}</p>
            <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">{s.kid} · paid {day(s.paidOn)}</p>
            {s.status === "submitted" ? <p className="mt-1 text-xs text-[var(--ds-on-surface-variant)]">The school is checking the bank. Your receipt appears here once it matches.</p> : null}
            {s.status === "rejected" ? <p className="mt-1 text-xs text-[var(--ds-color-danger-400)]">Not matched: {s.reason}</p> : null}
          </div>
          <div className="flex flex-col items-end gap-2">
            <Money paise={s.amountPaise} size="md" />
            {s.status === "verified" && s.receiptId ? <Link href={`/app/fees/receipts/${s.receiptId}`} className={buttonVariants({ variant: "secondary", size: "sm", className: "rounded-full" })}>Open receipt</Link> : null}
            {s.status === "rejected" ? <Link href={`/app/fees/pay?bills=${s.invoiceIds.join(",")}`} className={buttonVariants({ size: "sm", className: "rounded-full" })}>Send again</Link> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
