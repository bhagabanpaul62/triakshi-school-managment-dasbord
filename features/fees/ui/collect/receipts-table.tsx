"use client";

import { useRouter } from "next/navigation";
import { SelectableTable } from "@smw/ui/finance/SelectableTable";
import type { DataTableProps } from "@smw/ui/shell/DataTable";

/** The register with a checkbox per row. Print opens one page with every chosen receipt on its own sheet. */
export function ReceiptsTable(table: DataTableProps) {
  const router = useRouter();
  return <SelectableTable {...table} noun="receipt" bulkActions={[{ label: "Print selected", run: (ids) => router.push(`/app/fees/receipts/print?ids=${ids.join(",")}`), clearAfter: false }]} />;
}
