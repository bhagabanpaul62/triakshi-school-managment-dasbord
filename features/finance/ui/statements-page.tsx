import Link from "next/link";
import { notFound } from "next/navigation";
import { IconChevronRight } from "@tabler/icons-react";
import { requireCtx } from "@smw/runtime";
import { fyOf, todayIST } from "@smw/feature-kit/money";
import { Panel } from "@smw/ui/kit/Panel";
import { EmptyLine } from "@smw/ui/finance/States";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { CashAccountService } from "../services/cash";
import { STATEMENTS, StatementService, defaultRange } from "../services/statements";
import { YearCloseService } from "../services/year-close";
import { FIELD, PILL, PRIMARY, ROW } from "./styles";

export const metadata = { title: "Statements" };

export default async function StatementsPage() {
  const ctx = await requireCtx();
  const svc = new StatementService(ctx);
  if (!svc.can("read")) notFound();
  const { from, to } = defaultRange(), today = todayIST();
  const banks = (await new CashAccountService(ctx).list()).filter((a) => a.kind === "bank" && a.isActive);
  const canClose = new YearCloseService(ctx).can("close");
  return (
    <>
      <PageHeader eyebrow="Finance" title="Statements" description="Every report the school needs, for any period. Click any figure to see the ledger and the entry behind it." />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Panel title="Reports">
            <ul className="flex flex-col">
              {STATEMENTS.map((s) => (
                <li key={s.kind}>
                  <Link href={`/app/finance/statements/${s.kind}`} className={ROW}>
                    <span className="min-w-0"><span className="block">{s.label}</span><span className="block text-xs text-[var(--ds-on-surface-muted)]">{s.hint}</span></span>
                    <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="flex flex-col gap-3 lg:col-span-4">
          <Panel title="Bank reconciliation">
            {banks.length === 0 ? <EmptyLine title="No bank account yet." hint="A bank account is needed to reconcile." />
              : <ul className="flex flex-col">{banks.map((b) => <li key={b.id}><Link href={`/app/finance/banking/${b.id}/statement`} className={ROW}><span className="truncate">{b.name}</span><IconChevronRight className="h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden /></Link></li>)}</ul>}
          </Panel>
          <Panel title="Export for Tally">
            <form method="get" action="/app/finance/export/tally" className="flex flex-col gap-3" aria-label="Tally export">
              <p className="text-xs text-[var(--ds-on-surface-muted)]">Receipt, payment, journal and contra vouchers with the ledgers they use, as one XML file for Tally Prime.</p>
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">From<input type="date" name="from" defaultValue={from} max={today} required className={FIELD} /></label>
                <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">To<input type="date" name="to" defaultValue={to} max={today} required className={FIELD} /></label>
              </div>
              <div><button type="submit" className={PRIMARY}>Download XML</button></div>
            </form>
          </Panel>
          {canClose ? (
            <Panel title="Year end">
              <p className="pb-3 text-xs text-[var(--ds-on-surface-muted)]">Carry the surplus forward and lock the year once the books are checked.</p>
              <Link href={`/app/finance/year-close?fy=${fyOf(today)}`} className={PILL}>Open year close</Link>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
