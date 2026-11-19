import type { ReactNode } from "react";
import { cn } from "@smw/ui/utils";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";

export type SimpleColumn<T> = { label: string; cell: (row: T) => ReactNode; right?: boolean; hideOnMobile?: boolean };

/** A plain table for short, unpaginated lists inside a panel (a school's domains, invoices, tickets). */
export function SimpleTable<T extends { id: string }>({ columns, rows, empty }: { columns: SimpleColumn<T>[]; rows: T[]; empty: { title: string; description: string } }) {
  if (rows.length === 0) return <WidgetEmptyState title={empty.title} description={empty.description} />;
  return (
    <div className="custom-scrollbar -mx-2 overflow-x-auto">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.label} scope="col" className={cn("px-2 pb-3 font-mono text-[11px] font-normal uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]", c.right ? "text-right" : "text-left", c.hideOnMobile && "hidden md:table-cell")}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="transition-colors duration-150 hover:bg-white/[0.04]">
              {columns.map((c) => <td key={c.label} className={cn("px-2 py-2.5", c.right && "text-right tabular-nums", c.hideOnMobile && "hidden md:table-cell")}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
