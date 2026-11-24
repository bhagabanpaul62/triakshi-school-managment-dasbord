"use client";

import { SelectableTable } from "@smw/ui/finance/SelectableTable";
import type { DataTableProps } from "@smw/ui/shell/DataTable";
import { toast } from "@smw/ui/shell/toast";
import { remindStudents } from "./actions";
import { remindSummary } from "./logic";

/** The dues list with a checkbox on each row: remind the families you pick. */
export function DuesTable({ canRemind, ...table }: DataTableProps & { canRemind: boolean }) {
  return (
    <SelectableTable {...table} noun="student" bulkActions={canRemind ? [{ label: "Remind families", run: async (ids) => {
      const r = await remindStudents(ids);
      if (!r.ok) return void toast(r.error, "danger");
      toast(remindSummary(r.data));
    } }] : []} />
  );
}
