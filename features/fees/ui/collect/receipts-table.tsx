"use client";

import { SelectableTable } from "@smw/ui/finance/SelectableTable";
import type { DataTableProps } from "@smw/ui/shell/DataTable";
import { toast } from "@smw/ui/shell/toast";

const MAX_PRINT = 100;

/** The register with a checkbox per row. Print selected opens one PDF with every chosen receipt; each is logged as a print. */
export function ReceiptsTable(table: DataTableProps) {
  return <SelectableTable {...table} noun="receipt" bulkActions={[{ label: "Print selected", run: (ids) => {
    if (ids.length > MAX_PRINT) return void toast(`Print up to ${MAX_PRINT} receipts at a time. Select fewer.`, "danger");
    window.open(`/app/fees/receipts/print?ids=${ids.join(",")}`, "_blank", "noopener");
  }, clearAfter: false }]} />;
}
