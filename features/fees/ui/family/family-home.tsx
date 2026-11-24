import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { BigStat } from "@smw/ui/kit/BigStat";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { buttonVariants } from "@smw/ui/ui/button";
import { formatPaise } from "@smw/ui/finance/logic";
import { EmptyLine } from "@smw/ui/finance/States";
import { Money } from "@smw/ui/finance/Money";
import { StateBadge } from "@smw/ui/finance/StateBadge";
import { Timeline } from "@smw/ui/finance/Timeline";
import { DeskService } from "../collect/desk-service";
import { day } from "../collect/shared";
import { loadFamily } from "./family-data";
import { OfficeLine } from "./office-line";
import { SlipStates } from "./slip-states";

/** /app/fees for a student login: what is due now, the bills, receipts and the whole history. Stream E's page renders this for students. */
export default async function FamilyHome() {
  const ctx = await requireCtx();
  const [fam, cfg] = await Promise.all([loadFamily(ctx), new DeskService(ctx).config()]);
  const online = cfg.upiOn && !!cfg.upi;
  const receipts = fam.kids.flatMap((k) => k.account.receipts.map((r) => ({ ...r, kid: k.name }))).sort((a, b) => b.date.localeCompare(a.date));
  const timeline = fam.kids.flatMap((k) => k.account.timeline.map((t) => ({ at: t.at, title: fam.kids.length > 1 ? `${k.name}: ${t.title}` : t.title, amountPaise: t.amountPaise || undefined, href: t.kind === "receipt" ? t.href : undefined, tone: t.kind === "receipt" ? "success" as const : t.kind === "slip" ? "info" as const : "default" as const }))).sort((a, b) => b.at.localeCompare(a.at));

  return (
    <>
      <PageHeader eyebrow="My fees" title="Fees" description="What is due, what you have paid, and how to pay."
        actions={fam.duePaise > 0 && online ? <Link href="/app/fees/pay" className={buttonVariants({ className: "rounded-full" })}>Pay {formatPaise(fam.duePaise)}</Link> : undefined} />
      {fam.kids.length === 0 ? <EmptyLine title="No fee bills yet." hint="When the school issues a bill for your child, it shows up here with a way to pay." /> : (
        <div className="flex flex-col gap-4">
          <Panel title="Due now">
            <BigStat label={fam.duePaise > 0 ? "To pay" : "Nothing due"} value={formatPaise(fam.duePaise)} tone={fam.bills.some((b) => b.state === "overdue") ? "danger" : "default"}
              hint={fam.next ? `Next: ${fam.next.label}, due ${day(fam.next.dueDate)}${fam.bills.some((b) => b.latePaise) ? ". Late fee included." : ""}` : "You are all paid up."} size="lg" />
            {fam.duePaise > 0 ? (online ? <Link href="/app/fees/pay" className={buttonVariants({ className: "mt-4 rounded-full" })}>Pay now</Link> : <div className="mt-4"><OfficeLine school={cfg.school} /></div>) : null}
          </Panel>

          {fam.bills.length ? (
            <Panel title="Bills to pay">
              <ul className="flex flex-col gap-2">
                {fam.bills.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] p-3 text-sm">
                    <span className="min-w-0"><span className="flex flex-wrap items-center gap-2">{b.label}<StateBadge state={b.state} /></span><span className="text-xs text-[var(--ds-on-surface-muted)]">{fam.kids.length > 1 ? `${b.kid} · ` : ""}{b.number} · due {day(b.dueDate)}</span></span>
                    <Money paise={b.openPaise + b.latePaise} size="md" tone={b.state === "overdue" ? "danger" : "default"} />
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <SlipStates kids={fam.kids} />

          <Panel title="Receipts and statements" action={fam.kids.length ? <span className="flex gap-2 text-xs">{fam.kids.map((k) => <Link key={k.id} href={`/app/fees/pay/statement?student=${k.id}`} target="_blank" className="underline underline-offset-4">Statement{fam.kids.length > 1 ? ` (${k.name})` : ""}</Link>)}</span> : undefined}>
            {receipts.length ? (
              <ul className="flex flex-col gap-2">
                {receipts.slice(0, 10).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                    <span><Link href={`/app/fees/receipts/${r.id}`} className="font-mono underline underline-offset-4">{r.number}</Link> <span className="text-xs text-[var(--ds-on-surface-muted)]">{day(r.date)}{fam.kids.length > 1 ? ` · ${r.kid}` : ""}</span> <StateBadge state={r.status} /></span>
                    <span className="flex items-center gap-3"><Money paise={r.amountPaise} size="sm" /><a href={`/app/fees/receipts/${r.id}/pdf`} target="_blank" rel="noopener" className="text-xs underline underline-offset-4">Download</a></span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-[var(--ds-on-surface-muted)]">No receipts yet. They appear here after you pay.</p>}
          </Panel>

          <Panel title="All years"><Timeline items={timeline} emptyText="Nothing has happened on this account yet." /></Panel>
        </div>
      )}
    </>
  );
}
