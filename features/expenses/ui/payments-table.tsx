"use client";

import { SelectableTable } from "@smw/ui/finance/SelectableTable";
import type { DataTableProps } from "@smw/ui/shell/DataTable";

/** Payments with a checkbox on each: pick bank transfers and download one file for the bank. */
export function PaymentsTable({ canManage, ...table }: DataTableProps & { canManage: boolean }) {
  return <SelectableTable {...table} noun="payment" bulkActions={canManage ? [{ label: "Bank file", run: (ids) => { window.open(`/app/expenses/payments/bank-file?ids=${ids.join(",")}`, "_blank"); } }] : []} />;
}
