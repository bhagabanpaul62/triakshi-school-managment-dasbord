"use client";

import { useRouter } from "next/navigation";
import { SelectableTable } from "@smw/ui/finance/SelectableTable";
import type { DataTableProps } from "@smw/ui/shell/DataTable";
import { toast } from "@smw/ui/shell/toast";
import { issueInvoices, remindInvoiceFamilies } from "./actions";
import { remindSummary } from "./logic";

const MAX_PRINT = 100;

/** The bills list with a checkbox on each row: issue drafts, print the chosen bills, or remind their families. */
export function InvoicesTable({ canIssue, canRemind, ...table }: DataTableProps & { canIssue: boolean; canRemind: boolean }) {
  const router = useRouter();
  return (
    <SelectableTable {...table} noun="bill" bulkActions={[
      ...(canIssue ? [{ label: "Issue drafts", run: async (ids: string[]) => {
        const drafts = ids.filter((id) => table.rows.find((r) => r.id === id)?.status === "draft");
        if (!drafts.length) return void toast("None of the chosen bills is a draft, so there is nothing to issue.", "danger");
        const r = await issueInvoices(drafts);
        if (!r.ok) return void toast(r.error, "danger");
        toast(`${r.data.count} bill${r.data.count === 1 ? "" : "s"} issued`);
        router.refresh();
      } }] : []),
      { label: "Print selected", run: (ids: string[]) => {
        const issued = ids.filter((id) => table.rows.find((r) => r.id === id)?.status === "issued");
        if (!issued.length) return void toast("Only issued bills have a file to print. Issue the drafts first.", "danger");
        if (issued.length > MAX_PRINT) return void toast(`Print up to ${MAX_PRINT} bills at a time. Select fewer.`, "danger");
        window.open(`/app/fees/invoices/print?ids=${issued.join(",")}`, "_blank", "noopener");
      }, clearAfter: false },
      ...(canRemind ? [{ label: "Remind families", run: async (ids: string[]) => {
        const r = await remindInvoiceFamilies(ids);
        if (!r.ok) return void toast(r.error, "danger");
        toast(remindSummary(r.data));
        router.refresh();
      } }] : []),
    ]} />
  );
}
