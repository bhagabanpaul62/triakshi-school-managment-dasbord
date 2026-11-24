import { Fragment } from "react";
import { IconDownload } from "@tabler/icons-react";
import { cn } from "../../lib/utils";
import { Money } from "./Money";
import { EmptyLine } from "./States";
import { PILL_BTN } from "./ui";
import { sumKeys } from "./logic";

export interface ReportColumn {
  key: string;
  label: string;
  /** money: integer paise, summed. number: summed. text: not summed. */
  type?: "text" | "money" | "number";
}

export interface ReportGroup {
  /** Group heading: a class, a head, a month. */
  label: string;
  rows: Record<string, unknown>[];
}

export interface ReportTableProps {
  columns: ReportColumn[];
  groups: ReportGroup[];
  /** Names the table for screen readers. */
  caption: string;
  /** Link that downloads the same report as CSV. Shows the button when set. */
  csvHref?: string;
  /** Label of the grand total row. Default "Total". */
  totalLabel?: string;
  /** Shown instead of the table when no group has rows. */
  emptyText?: string;
}

const align = (t: ReportColumn["type"]) => (t === "money" || t === "number" ? "text-right" : "text-left");

function Cell({ col, value }: { col: ReportColumn; value: unknown }) {
  if (value == null || value === "") return <span className="text-[var(--ds-on-surface-muted)]">-</span>;
  if (col.type === "money") return <Money paise={Number(value)} />;
  if (col.type === "number") return <span className="tabular-nums">{Number(value).toLocaleString("en-IN")}</span>;
  return <>{String(value)}</>;
}

/** Rows grouped under headings with a subtotal for each group and a grand total. The table scrolls inside its own panel, header stuck on top. */
export function ReportTable({ columns, groups, caption, csvHref, totalLabel = "Total", emptyText = "No rows for this period." }: ReportTableProps) {
  const live = groups.filter((g) => g.rows.length > 0);
  const sumCols = columns.filter((c) => c.type === "money" || c.type === "number").map((c) => c.key);
  const grand = sumKeys(live.flatMap((g) => g.rows), sumCols);
  if (live.length === 0) return <EmptyLine title={emptyText} />;

  const totalRow = (label: string, sums: Record<string, number>, strong: boolean) => (
    <tr className={cn(strong ? "bg-white/[0.06] font-medium" : "font-medium text-[var(--ds-on-surface-variant)]")}>
      {columns.map((c, i) => (
        <td key={c.key} className={cn("px-4 py-2.5", align(c.type))}>
          {i === 0 ? label : sumCols.includes(c.key) ? <Cell col={c} value={sums[c.key]} /> : null}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="min-w-0">
      {csvHref ? <div className="mb-3 flex justify-end"><a href={csvHref} download className={PILL_BTN}><IconDownload className="h-4 w-4" aria-hidden />CSV</a></div> : null}
      <div className="custom-scrollbar max-h-[70vh] overflow-auto rounded-2xl bg-white/[0.03]">
        <table className="w-full min-w-[520px] text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 bg-[var(--ds-surface-container-high)]">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("px-4 py-3 font-mono text-[11px] font-normal uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]", align(c.type))}>{c.label}</th>
              ))}
            </tr>
          </thead>
          {live.map((g) => (
            <tbody key={g.label}>
              <tr><th scope="rowgroup" colSpan={columns.length} className="px-4 pb-1 pt-4 text-left text-[13px] font-medium text-[var(--ds-on-surface)]">{g.label}</th></tr>
              {g.rows.map((r, ri) => (
                <tr key={ri} className="transition-colors hover:bg-white/[0.04]">
                  {columns.map((c, i) => {
                    const cell = <Cell col={c} value={r[c.key]} />;
                    return i === 0 ? <th key={c.key} scope="row" className="px-4 py-2.5 text-left font-normal">{cell}</th> : <td key={c.key} className={cn("px-4 py-2.5", align(c.type))}>{cell}</td>;
                  })}
                </tr>
              ))}
              <Fragment>{sumCols.length ? totalRow(`${g.label} total`, sumKeys(g.rows, sumCols), false) : null}</Fragment>
            </tbody>
          ))}
          <tfoot className="sticky bottom-0 bg-[var(--ds-surface-container-high)]">{sumCols.length ? totalRow(totalLabel, grand, true) : null}</tfoot>
        </table>
      </div>
    </div>
  );
}
