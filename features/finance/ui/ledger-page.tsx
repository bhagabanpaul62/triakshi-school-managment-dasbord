import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { KeyTotals } from "@smw/ui/finance/KeyTotals";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { AccountService } from "../services/accounts";
import { JOURNAL_KIND_LABEL, JOURNAL_KIND_TONE } from "./labels";

export const metadata = { title: "Account ledger" };

const columns: Column[] = [
  { key: "date", label: "Date", type: "date" },
  { key: "number", label: "Entry", type: "mono" },
  { key: "memo", label: "Narration", hideOnMobile: true },
  { key: "kind", label: "Kind", type: "badge", tones: JOURNAL_KIND_TONE, labels: JOURNAL_KIND_LABEL, hideOnMobile: true },
  { key: "debitPaise", label: "Debit", type: "money" },
  { key: "creditPaise", label: "Credit", type: "money" },
  { key: "runningPaise", label: "Balance", type: "money" },
];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function LedgerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const svc = new AccountService(await requireCtx());
  if (!svc.can("read")) notFound();
  const from = one(sp.from), to = one(sp.to);
  const data = await svc.ledger(id, { from, to, page: Number(one(sp.page)) || 1 }).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const { account, openingPaise, closingPaise, rows } = data;
  const debit = rows.rows.reduce((s, r) => s + r.debitPaise, 0), credit = rows.rows.reduce((s, r) => s + r.creditPaise, 0);

  return (
    <>
      <PageHeader eyebrow="Accounts" title={<><span className="mr-2 font-mono text-[var(--ds-on-surface-muted)]">{account.code}</span>{account.name}</>}
        description={`${account.group}. Balance is debits minus credits, so ${account.type === "asset" || account.type === "expense" ? "a positive number is normal here" : "a negative number is normal here"}.`}
        actions={<Link href="/app/finance/accounts" className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">All accounts</Link>} />
      <div className="pb-8">
        <KeyTotals items={[{ label: "Opening", paise: openingPaise }, { label: "Debits on this page", paise: debit }, { label: "Credits on this page", paise: credit }, { label: "Closing", paise: closingPaise, strong: true }]} />
      </div>
      <DataTable columns={columns} rows={rows.rows.map((r) => ({ ...r }))} total={rows.total} page={rows.page} pageCount={rows.pageCount} rowHref="/app/finance/journals/{journalId}" searchable={false}
        toolbar={(
          <form method="get" className="flex flex-wrap items-end gap-2" aria-label="Date range">
            <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">From<input type="date" name="from" defaultValue={from} className="h-10 rounded-xl bg-white/[0.05] px-3 text-sm text-[var(--ds-on-surface)]" /></label>
            <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">To<input type="date" name="to" defaultValue={to} className="h-10 rounded-xl bg-white/[0.05] px-3 text-sm text-[var(--ds-on-surface)]" /></label>
            <button type="submit" className="h-10 rounded-full bg-white/[0.08] px-4 text-sm hover:bg-white/[0.12]">Show</button>
          </form>
        )}
        empty={{ title: "No entries in this range.", description: "Entries appear as soon as something posts to this account." }} />
    </>
  );
}
