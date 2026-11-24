import Link from "next/link";
import { notFound } from "next/navigation";
import { IconDownload } from "@tabler/icons-react";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { todayIST } from "@smw/feature-kit/money";
import { Money } from "@smw/ui/finance/Money";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { BankService, reconciliationReport } from "../services/bank";
import { PrintButton } from "./print-button";
import { ReportView } from "./report-view";
import { FIELD, LINK, PILL, href, one, type SearchParams } from "./styles";

export const metadata = { title: "Bank reconciliation" };

/** The statement of reconciliation of one bank account on a day: books, what the bank has not caught up with, and the balance the bank should show. */
export default async function BankStatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const [{ id }, sp, ctx] = await Promise.all([params, searchParams, requireCtx()]);
  const svc = new BankService(ctx);
  if (!svc.can("read")) notFound();
  const asOn = one(sp.asOn) ?? todayIST(), bank = one(sp.bank);
  const bankPaise = bank && Number.isFinite(Number(bank)) ? Math.round(Number(bank) * 100) : undefined;
  const r = await svc.reconciliation(id, { asOn, bankBalancePaise: bankPaise }).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const file = (format: "csv" | "pdf") => href("/app/finance/export/bank-reconciliation", { format, cashAccountId: id, asOn, bank });
  const open = r.uncredited.length + r.unpresented.length + r.bankOnly.length;
  return (
    <>
      <PageHeader eyebrow="Banking" title={`Bank reconciliation: ${r.account.name}`} description={`As on ${asOn}. Enter the closing balance from the bank's own statement to see if the books agree.`}
        actions={<>
          {svc.can("reconcile") ? <Link href={`/app/finance/banking/${id}`} className={`${PILL} print:hidden`}>Back to the statement</Link> : <Link href="/app/finance/statements" className={`${PILL} print:hidden`}>All statements</Link>}
          <PrintButton />
          <a href={file("csv")} download className={`${PILL} gap-2 print:hidden`}><IconDownload className="h-4 w-4" aria-hidden />CSV</a>
          <a href={file("pdf")} download className={`${PILL} gap-2 print:hidden`}><IconDownload className="h-4 w-4" aria-hidden />PDF</a>
        </>} />
      <form method="get" className="flex flex-wrap items-end gap-3 pb-6 print:hidden" aria-label="Choose the day and the bank balance">
        <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">As on<input type="date" name="asOn" defaultValue={asOn} max={todayIST()} className={FIELD} /></label>
        <label className="flex flex-col gap-1 text-xs text-[var(--ds-on-surface-muted)]">Closing balance on the bank statement, in rupees<input type="number" step="0.01" name="bank" defaultValue={bank} placeholder="Optional" className={`${FIELD} w-56`} /></label>
        <button type="submit" className={PILL}>Show</button>
      </form>
      <div className="flex flex-wrap gap-x-10 gap-y-4 pb-6">
        <div><p className="text-[13px] text-[var(--ds-on-surface-variant)]">Balance per books</p><Money paise={r.bookPaise} size="xl" /></div>
        <div><p className="text-[13px] text-[var(--ds-on-surface-variant)]">The bank should show</p><Money paise={r.expectedBankPaise} size="xl" /></div>
        {r.differencePaise !== null ? <div><p className="text-[13px] text-[var(--ds-on-surface-variant)]">Difference</p><Money paise={r.differencePaise} size="xl" tone={r.differencePaise === 0 ? "success" : "danger"} /></div> : null}
      </div>
      <ReportView report={reconciliationReport(r)} />
      {open > 0 && svc.can("reconcile") ? <p className="mt-4 text-sm text-[var(--ds-on-surface-variant)] print:hidden">Bank-only items need an entry in the books: <Link href={`/app/finance/banking/${id}`} className={LINK}>record them from the statement</Link>.</p> : null}
    </>
  );
}
