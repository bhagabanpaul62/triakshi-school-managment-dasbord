import Link from "next/link";
import { notFound } from "next/navigation";
import { IconCheck, IconX } from "@tabler/icons-react";
import { requireCtx } from "@smw/runtime";
import { fyOf, todayIST } from "@smw/feature-kit/money";
import { Panel } from "@smw/ui/kit/Panel";
import { Money } from "@smw/ui/finance/Money";
import { EmptyLine } from "@smw/ui/finance/States";
import { shortDate } from "@smw/ui/format";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal, type FormResult } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { cn } from "@smw/ui/utils";
import { YearCloseService, type YearCloseOptions } from "../services/year-close";
import { LINK, MUTED, PILL, one, type SearchParams } from "./styles";

export const metadata = { title: "Year close" };
const FY = /^\d{4}-\d{2}$/;
const shift = (fy: string, n: number) => { const y = Number(fy.slice(0, 4)) + n; return `${y}-${String((y + 1) % 100).padStart(2, "0")}`; };
type Action = (fd: FormData) => Promise<FormResult>;

/**
 * The yearly close: a checklist of what must be true, the entry it will post, and the one button. The route passes the checks
 * other modules add, so finance imports none of them.
 */
export default async function YearClosePage({ searchParams, options, run, reopen }: { searchParams: SearchParams; options?: YearCloseOptions; run: Action; reopen: Action }) {
  const [sp, ctx] = await Promise.all([searchParams, requireCtx()]);
  const svc = new YearCloseService(ctx, options);
  if (!svc.can("close")) notFound();
  const fy = FY.test(one(sp.fy) ?? "") ? one(sp.fy)! : fyOf(todayIST());
  const [p, history] = await Promise.all([svc.preview(fy), svc.history()]);
  const closed = p.current?.status === "closed";
  const blocked = p.checks.filter((c) => c.blocking && !c.ok).length;

  return (
    <>
      <PageHeader eyebrow="Finance" title={`Close the year ${fy}`} description={`${p.from} to ${p.to}. The surplus moves to the accumulated surplus, all twelve months lock, and the next year opens with exactly these balances.`}
        actions={<><Link href={`/app/finance/year-close?fy=${shift(fy, -1)}`} className={PILL}>Earlier year</Link><Link href={`/app/finance/year-close?fy=${shift(fy, 1)}`} className={PILL}>Later year</Link></>} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="flex flex-col gap-3 lg:col-span-7">
          <Panel title="Before you close">
            <ul className="flex flex-col gap-1">
              {p.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-3 rounded-xl px-2 py-2 text-sm">
                  <span className={cn("mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full", c.ok ? "bg-[var(--ds-color-success-500)]/15 text-[var(--ds-color-success-400)]" : c.blocking ? "bg-[var(--ds-color-danger-500)]/15 text-[var(--ds-color-danger-400)]" : "bg-white/[0.08] text-[var(--ds-on-surface-muted)]")}>
                    {c.ok ? <IconCheck className="h-3.5 w-3.5" aria-label="Done" /> : <IconX className="h-3.5 w-3.5" aria-label={c.blocking ? "Must be fixed" : "For your information"} />}
                  </span>
                  <span className="min-w-0 flex-1"><span className="block">{c.label}</span><span className={cn("block", MUTED)}>{c.detail}</span></span>
                  {c.href ? <Link href={`${c.href}${c.href.includes("?") ? "&" : "?"}next=${encodeURIComponent(`/app/finance/year-close?fy=${fy}`)}`} className={cn(LINK, "shrink-0")}>Fix it</Link> : null}
                </li>
              ))}
            </ul>
          </Panel>
          {closed ? (
            <Panel title="This year is closed">
              <p className="text-sm text-[var(--ds-on-surface-variant)]">Closed with a {p.current!.surplusPaise >= 0 ? "surplus" : "deficit"} of <Money paise={Math.abs(p.current!.surplusPaise)} />. {p.current!.journalId ? <><Link href={`/app/finance/journals/${p.current!.journalId}`} className={LINK}>Open the closing entry</Link>.</> : "There was no income or expense to carry."}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {p.reopenPending ? <p className="text-sm">A request to reopen is waiting for another admin. <Link href="/app/finance/approvals" className={LINK}>Open approvals</Link></p> : (
                  <FormModal title={`Ask to reopen ${fy}`} icon="clock" action={reopen} hidden={{ fy }} submitLabel="Ask to reopen" trigger={{ label: "Ask to reopen", variant: "secondary" }}
                    description="Another admin must approve. The closing entry is undone and the twelve months open again. Close the year again when the correction is made."
                    fields={[{ name: "reason", label: "Why is it being reopened?", type: "textarea", required: true, wide: true }]} />
                )}
                <Link href={`/app/finance/statements/balance-sheet?period=FY${fy.slice(0, 4)}`} className={PILL}>Balance sheet</Link>
              </div>
            </Panel>
          ) : (
            p.closePending ? (
              <Panel title="Waiting for a decision">
                <p className="text-sm text-[var(--ds-on-surface-variant)]">Closing {fy} was asked for. Nothing is posted or locked until it is approved. <Link href="/app/finance/approvals" className={LINK}>Open approvals</Link></p>
              </Panel>
            ) : <Panel title="Close the year">
              <p className="pb-4 text-sm text-[var(--ds-on-surface-variant)]">{blocked ? `${blocked} thing${blocked === 1 ? "" : "s"} above must be fixed first.` : "Everything is in order. Another admin approves the close; if you are the only admin, you approve it yourself with a reason."}</p>
              {blocked ? <p className={MUTED}>The button appears when every item above is done.</p> : (
                <ActionButton label={`Ask to close ${fy}`} variant="default" action={run} values={{ fy }} successMessage="Sent for approval"
                  confirm={{ title: `Ask to close ${fy}?`, body: `Once approved, a ${p.surplusPaise >= 0 ? "surplus" : "deficit"} of ₹${(Math.abs(p.surplusPaise) / 100).toLocaleString("en-IN")} moves to the accumulated surplus and all twelve months lock. A late entry will land in the next open month.`, confirmLabel: "Send for approval" }} />
              )}
            </Panel>
          )}
        </div>
        <div className="flex flex-col gap-3 lg:col-span-5">
          <Panel title="The closing entry">
            {p.lines.length === 0 ? <EmptyLine title="No income or expense to carry." hint="The year can still be closed to lock its months." /> : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                  <span><span className={MUTED}>Income </span><Money paise={p.incomeTotalPaise} /></span>
                  <span><span className={MUTED}>Expense </span><Money paise={p.expenseTotalPaise} /></span>
                  <span><span className={MUTED}>{p.surplusPaise >= 0 ? "Surplus " : "Deficit "}</span><Money paise={Math.abs(p.surplusPaise)} tone={p.surplusPaise >= 0 ? "success" : "danger"} /></span>
                </div>
                <div className="overflow-x-auto"><table className="w-full min-w-[320px] text-sm">
                  <caption className="sr-only">What the closing entry posts</caption>
                  <thead><tr className="text-left font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]"><th className="py-1 font-normal">Account</th><th className="py-1 text-right font-normal">Debit</th><th className="py-1 text-right font-normal">Credit</th></tr></thead>
                  <tbody>{p.lines.map((l) => <tr key={l.accountId}><td className="py-1.5 pr-3"><Link href={`/app/finance/accounts/${l.accountId}?to=${p.to}`} className={cn(LINK, "no-underline hover:underline")}><span className={MUTED}>{l.code}</span> {l.name}</Link></td><td className="py-1.5 text-right"><Money paise={l.debitPaise || null} /></td><td className="py-1.5 text-right"><Money paise={l.creditPaise || null} /></td></tr>)}</tbody>
                </table></div>
              </div>
            )}
          </Panel>
          <Panel title="Closed years">
            {history.length === 0 ? <p className={MUTED}>No year has been closed yet.</p> : (
              <ul className="flex flex-col">{history.map((h) => <li key={h.id} className="flex min-h-11 items-center justify-between gap-3 px-2 py-2 text-sm"><Link href={`/app/finance/year-close?fy=${h.fy}`} className={cn(LINK, "no-underline hover:underline")}>{h.fy}{h.run > 1 ? ` (closed again, run ${h.run})` : ""}</Link><span className={MUTED}>{h.status === "closed" ? "Closed" : `Reopened ${h.reopenedAt ? shortDate(h.reopenedAt.toISOString().slice(0, 10)) : ""}`}</span></li>)}</ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
