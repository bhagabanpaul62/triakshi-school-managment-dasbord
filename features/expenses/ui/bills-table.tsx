"use client";

import { useRouter } from "next/navigation";
import { SelectableTable } from "@smw/ui/finance/SelectableTable";
import type { DataTableProps } from "@smw/ui/shell/DataTable";
import { toast } from "@smw/ui/shell/toast";
import { submitBills } from "./actions";

/** The bills list with a checkbox on each row: send drafts for approval, or pay the selected bills in one go. */
export function BillsTable({ canManage, ...table }: DataTableProps & { canManage: boolean }) {
  const router = useRouter();
  return (
    <SelectableTable {...table} noun="bill" bulkActions={canManage ? [
      { label: "Send for approval", run: async (ids) => {
        const r = await submitBills(ids);
        if (!r.ok) return void toast(r.error, "danger");
        const bad = r.data.filter((x) => !x.ok);
        toast(bad.length ? `${r.data.length - bad.length} sent. ${bad[0]!.message}` : `${r.data.length} bill(s) sent`, bad.length ? "danger" : undefined);
        router.refresh();
      } },
      { label: "Pay selected", run: (ids) => router.push(`/app/expenses/payments/new?bills=${ids.join(",")}`) },
    ] : []} />
  );
}
