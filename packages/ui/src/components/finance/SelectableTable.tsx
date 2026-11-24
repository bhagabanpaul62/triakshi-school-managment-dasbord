"use client";

import { useState, useTransition, type ReactNode } from "react";
import { DataTable, type DataTableProps } from "../../shell/DataTable";
import { BulkBar } from "./BulkBar";
import { FOCUS } from "./ui";
import { cn } from "../../lib/utils";

export interface SelectableAction {
  label: string;
  /** Runs with the selected row ids. A server action works. */
  run: (ids: string[]) => void | Promise<unknown>;
  tone?: "default" | "danger";
  /** Clear the selection after it runs. Default true. */
  clearAfter?: boolean;
}

export interface SelectableTableProps extends DataTableProps {
  bulkActions: SelectableAction[];
  /** Singular name for the count: "bill". */
  noun?: string;
}

const box = "h-5 w-5 cursor-pointer accent-[var(--ds-primary)]";

/**
 * DataTable with a checkbox for every row and a bar of bulk actions.
 * shortcut: selection covers the rows on the current page only; carry ids in the URL if cross-page selection is needed.
 */
export function SelectableTable({ bulkActions, noun, rows, ...table }: SelectableTableProps) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const pageIds = rows.map((r) => String(r.id ?? ""));
  const ids = pageIds.filter((id) => chosen.has(id));
  const allOn = pageIds.length > 0 && ids.length === pageIds.length;
  const toggle = (id: string) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const cells: Record<string, ReactNode> = {};
  rows.forEach((row, i) => {
    const id = pageIds[i]!;
    const name = String(row[table.columns[0]?.key ?? "id"] ?? "") || "this row";
    cells[id] = (
      <label className="flex h-10 w-10 items-center justify-center">
        <span className="sr-only">Select {name}</span>
        <input type="checkbox" checked={chosen.has(id)} onChange={() => toggle(id)} className={cn(box, FOCUS)} />
      </label>
    );
  });

  return (
    <>
      <DataTable
        {...table}
        rows={rows}
        leading={{
          cells,
          header: (
            <label className="flex h-10 w-10 items-center justify-center">
              <span className="sr-only">Select all on this page</span>
              <input type="checkbox" checked={allOn} onChange={() => setChosen(allOn ? new Set() : new Set(pageIds))} className={cn(box, FOCUS)} />
            </label>
          ),
        }}
      />
      <BulkBar
        count={ids.length}
        noun={noun}
        onClear={() => setChosen(new Set())}
        actions={bulkActions.map((a) => ({
          label: a.label,
          tone: a.tone,
          disabled: pending,
          onClick: () => start(async () => { await a.run(ids); if (a.clearAfter !== false) setChosen(new Set()); }),
        }))}
      />
    </>
  );
}
