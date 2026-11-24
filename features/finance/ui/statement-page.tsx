import Link from "next/link";
import { notFound } from "next/navigation";
import { IconDownload } from "@tabler/icons-react";
import { ValidationError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { todayIST } from "@smw/feature-kit/money";
import { PeriodPicker } from "@smw/ui/finance/PeriodPicker";
import { parsePeriod, periodLabel, presetPeriod } from "@smw/ui/finance/logic";
import { EmptyLine } from "@smw/ui/finance/States";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { AccountService } from "../services/accounts";
import { CashAccountService } from "../services/cash";
import { STATEMENTS, StatementService, type CompareMode, type StatementKind } from "../services/statements";
import { ReportView } from "./report-view";
import { FIELD, PILL, href, one, type SearchParams } from "./styles";

const COMPARABLE: StatementKind[] = ["income-expenditure", "receipts-payments", "balance-sheet"];
const BOOKS: StatementKind[] = ["cash-book", "bank-book"];

export default async function StatementPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: SearchParams }) {
  const [{ kind: raw }, sp, ctx] = await Promise.all([params, searchParams, requireCtx()]);
  const meta = STATEMENTS.find((s) => s.kind === raw);
  const svc = new StatementService(ctx);
  if (!meta || !svc.can("read")) notFound();
  const kind = meta.kind, today = todayIST();
  const period = one(sp.period) ? parsePeriod({ period: one(sp.period), from: one(sp.from), to: one(sp.to) }, today) : presetPeriod("this_fy", today);
  const compare = COMPARABLE.includes(kind) && (one(sp.compare) === "previous" || one(sp.compare) === "year") ? (one(sp.compare) as CompareMode) : undefined;
  const accountId = one(sp.accountId), cashAccountId = one(sp.cashAccountId), page = Number(one(sp.page)) || 1;
  const [accounts, cash] = await Promise.all([kind === "ledger" ? new AccountService(ctx).withBalances() : [], BOOKS.includes(kind) ? new CashAccountService(ctx).list() : []]);
  const query = { kind, from: period.from, to: period.to, compare, accountId, cashAccountId, page };
  const result = kind === "ledger" && !accountId ? null : await svc.run(query).catch((e) => { if (e instanceof ValidationError) return null; throw e; });
  const download = (format: "csv" | "pdf") => href(`/app/finance/export/${kind}`, { format, from: period.from, to: period.to, compare, accountId, cashAccountId });
  const keep = { period: one(sp.period), from: one(sp.from), to: one(sp.to) };
  const moneyKind = kind === "cash-book" ? "cash" : "bank";
  const accountsOfKind = cash.filter((a) => a.kind === moneyKind);
  const pageLink = (p: number) => href(`/app/finance/statements/${kind}`, { ...keep, compare, accountId, cashAccountId, page: p > 1 ? p : undefined });

  return (
    <>
      <PageHeader eyebrow="Statements" title={meta.label} description={`${meta.hint} ${periodLabel(period)}.`}
        actions={<>
          <Link href="/app/finance/statements" className={PILL}>All statements</Link>
          <a href={download("csv")} download className={`${PILL} gap-2`}><IconDownload className="h-4 w-4" aria-hidden />CSV</a>
          <a href={download("pdf")} download className={`${PILL} gap-2`}><IconDownload className="h-4 w-4" aria-hidden />PDF</a>
        </>} />
      <div className="flex flex-col gap-4 pb-6">
        <PeriodPicker today={today} presets={["this_month", "last_month", "this_quarter", "this_fy", "last_fy"]} fallback={presetPeriod("this_fy", today)} />
        {COMPARABLE.includes(kind) || kind === "ledger" || (BOOKS.includes(kind) && accountsOfKind.length > 1) ? (
          <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Options">
            {Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
            {COMPARABLE.includes(kind) ? (
              <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Compare with
                <select name="compare" defaultValue={compare ?? ""} className={FIELD}><option value="">Nothing</option><option value="previous">The period before</option><option value="year">The same period last year</option></select>
              </label>
            ) : null}
            {kind === "ledger" ? (
              <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Account
                <select name="accountId" defaultValue={accountId ?? ""} required className={`${FIELD} min-w-56`}><option value="" disabled>Choose an account</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select>
              </label>
            ) : null}
            {BOOKS.includes(kind) && accountsOfKind.length > 1 ? (
              <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Account
                <select name="cashAccountId" defaultValue={cashAccountId ?? ""} className={`${FIELD} min-w-48`}><option value="">All</option>{accountsOfKind.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
              </label>
            ) : null}
            <button type="submit" className={PILL}>Show</button>
          </form>
        ) : null}
      </div>
      {result === null ? (
        <EmptyLine title="Choose an account to see its ledger." hint="Pick one above, then press Show. You can also open any account from the Accounts page." action={<Link href="/app/finance/accounts" className={PILL}>Open accounts</Link>} />
      ) : (
        <>
          <ReportView report={result.report} />
          {result.page && result.page.pageCount > 1 ? (
            <nav aria-label="Pages" className="mt-4 flex items-center justify-between text-sm text-[var(--ds-on-surface-muted)]">
              <span>{result.page.total} lines, page {result.page.page} of {result.page.pageCount}</span>
              <span className="flex gap-2">
                {result.page.page > 1 ? <Link href={pageLink(result.page.page - 1)} className={PILL}>Previous</Link> : null}
                {result.page.page < result.page.pageCount ? <Link href={pageLink(result.page.page + 1)} className={PILL}>Next</Link> : null}
              </span>
            </nav>
          ) : null}
        </>
      )}
    </>
  );
}
