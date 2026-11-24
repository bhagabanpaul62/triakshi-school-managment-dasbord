import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { todayIST } from "@smw/feature-kit/money";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { buttonVariants } from "@smw/ui/ui/button";
import { ConfirmMoney } from "@smw/ui/finance/ConfirmMoney";
import { OUT_METHODS } from "../constants";
import { IncomeService, LookupService } from "../service";
import { recordIncome, requestIncomeReversal } from "./actions";
import { JournalLink, NoAccess, OneRecord, SectionNav, can, one, type Search } from "./shared";

export const metadata = { title: "Other income" };

const columns: Column[] = [
  { key: "number", label: "Receipt", type: "mono" }, { key: "date", label: "Date", type: "date" }, { key: "fromName", label: "From", type: "person", metaKey: "label" },
  { key: "method", label: "Method", type: "badge", labels: { bank_transfer: "Bank", upi: "UPI", cash: "Cash", cheque: "Cheque", card: "Card" }, hideOnMobile: true }, { key: "amountPaise", label: "Amount", type: "money" }, { key: "state", label: "State", type: "state" },
];

export default async function IncomePage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "read")) return <NoAccess ctx={ctx} what="Other income" who="accountants and admins" />;
  const sp = await searchParams, manage = can(ctx, "manage");
  const [page, accounts, cash] = await Promise.all([new IncomeService(ctx).list(listQueryFrom(sp)), new LookupService(ctx).accounts("income"), manage ? new LookupService(ctx).cashAccounts() : []]);
  const rows = page.rows.map((r) => ({ ...r, state: r.status === "reversed" ? "reversed" : r.reversalPending ? "pending" : "valid" }));
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && k !== "page" ? [[k, v]] : []))).toString();
  const add = manage ? <FormModal title="Record other income" icon="money" size="lg" action={recordIncome} submitLabel="Save and number it" values={{ date: todayIST(), method: "cash" }} trigger={{ label: "Record income", plus: true }}
    summary={<p className="text-sm text-[var(--ds-on-surface-variant)]">Money goes into the chosen cash or bank account and is counted as income. A numbered receipt is made.</p>}
    fields={[
      { name: "fromName", label: "Received from", required: true, wide: true }, { name: "label", label: "For", required: true, wide: true, placeholder: "Hall rent, donation, scrap sale" },
      { name: "amountPaise", label: "Amount", type: "money", required: true }, { name: "date", label: "Date", type: "date", max: todayIST() },
      { name: "accountId", label: "Counted as", type: "select", required: true, options: accounts.map((a) => ({ value: a.id, label: a.name })) },
      { name: "method", label: "How it came", type: "select", required: true, options: OUT_METHODS.map((m) => ({ value: m, label: m.replace(/_/g, " ") })) },
      { name: "cashAccountId", label: "Into", type: "select", options: cash.map((c) => ({ value: c.id, label: c.name })), hint: "Blank uses the default cash box or bank." }, { name: "reference", label: "Reference (UTR, cheque no)" },
    ]} /> : null;

  return (
    <>
      <PageHeader eyebrow="Expenses" title="Other income" description="Money in that is not fees: hall rent, donations, scrap, interest."
        actions={<><Link href={`/app/expenses/income/csv${qs ? `?${qs}` : ""}`} prefetch={false} className={buttonVariants({ variant: "ghost", className: "rounded-full" })}>Download CSV</Link>{add}</>} />
      <SectionNav ctx={ctx} current="/app/expenses/income" />
      {one(sp.id) ? <OneRecord all="/app/expenses/income" /> : null}
      <DataTable columns={columns} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} searchPlaceholder="Search receipt, name or purpose"
        filters={[{ key: "status", label: "State", options: [{ value: "valid", label: "Valid" }, { value: "reversed", label: "Reversed" }] }]}
        rowActions={Object.fromEntries(rows.map((r) => [r.id, (
          <span key={r.id} className="inline-flex flex-wrap items-center justify-end gap-1">
            <Link href={`/app/expenses/income/${r.id}/receipt`} target="_blank" className={buttonVariants({ variant: "ghost", className: "rounded-full" })}>Receipt</Link>
            <JournalLink id={r.journalId} label="Entry" />
            {manage && r.status === "valid" && !r.reversalPending ? <ConfirmMoney label="Reverse" title={`Reverse ${r.number}`} action={requestIncomeReversal} values={{ id: r.id }} amountPaise={r.amountPaise} danger confirmLabel="Ask to reverse" consequence="An approver must agree. Then the books are corrected with a mirror entry; the receipt number stays and prints REVERSED." successMessage="Sent to an approver" /> : null}
            {r.reversalPending ? <Link href="/app/finance/approvals" className="px-2 text-xs underline underline-offset-4">Waiting for approval</Link> : null}
          </span>
        )]))}
        empty={{ title: "No other income yet", description: "Hall rent, a donation or bank interest goes here, with a numbered receipt.", action: add ?? undefined }} />
    </>
  );
}
