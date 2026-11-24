import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { BankService } from "../services/bank";
import { checkBankImport, importBankStatement } from "./actions";
import { BankImportForm } from "./bank-import-form";
import { PILL } from "./styles";

export const metadata = { title: "Import a bank statement" };

export default async function BankImportPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, ctx] = await Promise.all([params, requireCtx()]);
  const svc = new BankService(ctx);
  if (!svc.can("reconcile")) notFound();
  const sum = (await svc.summary()).find((s) => s.account.id === id);
  if (!sum) notFound();
  return (
    <>
      <PageHeader eyebrow="Banking" title={`Import a statement into ${sum.account.name}`} description="From the bank's website: download the statement as .csv or .xlsx. Lines that match an entry in the books are matched for you."
        actions={<Link href={`/app/finance/banking/${id}`} className={PILL}>Back to the statement</Link>} />
      <BankImportForm cashAccountId={id} check={checkBankImport} commit={importBankStatement} doneHref={`/app/finance/banking/${id}`} />
    </>
  );
}
