import { requireCtx } from "@smw/runtime";
import { DocumentPaper } from "@smw/ui/finance/DocumentPaper";
import { EmptyLine } from "@smw/ui/finance/States";
import { DeskService } from "./desk-service";
import { PrintBar } from "./print-bar";
import { BackLink, NoAccess, can, one, type Search } from "./shared";

export const metadata = { title: "Print receipts" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Each sheet flows on its own page instead of being pinned to the top left, which would stack them.
const FLOW = "@media print{.print-sheets [data-fin-print]{position:static!important;break-after:page}}";

export default async function ReceiptPrintPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "read")) return <NoAccess what="Printing receipts" who="accountants, admins and auditors" />;
  const ids = one((await searchParams).ids).split(",").filter((i) => UUID.test(i));
  if (!ids.length) return <><BackLink href="/app/fees/receipts">All receipts</BackLink><EmptyLine title="No receipts chosen." hint="Tick receipts in the register, then press Print selected." /></>;
  const sheets = await new DeskService(ctx).printSheets(ids);
  return (
    <div className="print-sheets">
      <style>{FLOW}</style>
      <PrintBar count={sheets.length} />
      <div className="flex flex-col gap-6">{sheets.map((s) => <DocumentPaper key={s.id} config={s.config} data={s.data} kind="receipt" mode="screen" />)}</div>
    </div>
  );
}
