import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { buttonVariants } from "@smw/ui/ui/button";
import { Money } from "@smw/ui/finance/Money";
import { shortDate } from "@smw/ui/format";
import { DuesService } from "../service";
import { can } from "./shared";

/**
 * The fee card on a student's record. Students cannot import fees, so the app route puts this into the record page.
 * It shows nothing when the module is off or the person may not read fees.
 */
export async function StudentFeeCard({ studentId }: { studentId: string }) {
  const ctx = await requireCtx();
  if (!ctx.features.has("fees") || !can(ctx, "read")) return null;
  const c = await new DuesService(ctx).card(studentId).catch(() => null);
  if (!c) return null;
  const base = `/app/fees/students/${studentId}`;
  return (
    <Panel title="Fees">
      {c.billed || c.owedPaise ? (
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-[var(--ds-on-surface-muted)]">Owed now</dt><dd><Money paise={c.owedPaise} size="lg" tone={c.overduePaise ? "danger" : "default"} /></dd></div>
          {c.overduePaise ? <div className="flex items-baseline justify-between gap-3"><dt className="text-[var(--ds-on-surface-muted)]">Overdue</dt><dd><Money paise={c.overduePaise} tone="danger" /></dd></div> : null}
          {c.advancePaise ? <div className="flex items-baseline justify-between gap-3"><dt className="text-[var(--ds-on-surface-muted)]">Advance held</dt><dd><Money paise={c.advancePaise} /></dd></div> : null}
          <div className="flex items-baseline justify-between gap-3"><dt className="text-[var(--ds-on-surface-muted)]">Next due</dt><dd>{c.nextDueDate ? shortDate(c.nextDueDate) : "-"}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-[var(--ds-on-surface-muted)]">Last receipt</dt><dd>{c.last ? <Link href={`/app/fees/receipts/${c.last.id}`} className="underline underline-offset-4">{c.last.number}, {shortDate(c.last.date)}</Link> : "-"}</dd></div>
        </dl>
      ) : <p className="text-sm text-[var(--ds-on-surface-muted)]">No bill has been made for this student yet.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {can(ctx, "collect") ? <Link href={`/app/fees/collect?student=${studentId}`} className={buttonVariants({ className: "rounded-full" })}>Collect</Link> : null}
        <Link href={base} className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Finance page</Link>
      </div>
    </Panel>
  );
}
