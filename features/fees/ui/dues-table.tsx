"use client";

import { SelectableTable } from "@smw/ui/finance/SelectableTable";
import type { DataTableProps } from "@smw/ui/shell/DataTable";
import { toast } from "@smw/ui/shell/toast";
import { remindStudents } from "./actions";

/** The dues list with a checkbox on each row: remind the families you pick. */
export function DuesTable({ canRemind, ...table }: DataTableProps & { canRemind: boolean }) {
  return (
    <SelectableTable {...table} noun="student" bulkActions={canRemind ? [{ label: "Remind families", run: async (ids) => {
      const r = await remindStudents(ids);
      if (!r.ok) return void toast(r.error, "danger");
      toast(`${r.data.sent} reminder${r.data.sent === 1 ? "" : "s"} sent${r.data.stopped ? `, ${r.data.stopped} skipped because reminders are stopped for them` : ""}${r.data.nothingOpen ? `, ${r.data.nothingOpen} had nothing open` : ""}`);
    } }] : []} />
  );
}
