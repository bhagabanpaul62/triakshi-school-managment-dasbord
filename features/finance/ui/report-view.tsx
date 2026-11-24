import Link from "next/link";
import { IconAlertTriangle } from "@tabler/icons-react";
import { Money } from "@smw/ui/finance/Money";
import { shortDate } from "@smw/ui/format";
import { cn } from "@smw/ui/utils";
import type { Report, ReportColumn, ReportRow } from "../services/report";
import { LINK } from "./styles";

const ROW_STYLE = { head: "bg-white/[0.04] font-medium", sub: "font-medium text-[var(--ds-on-surface-variant)]", total: "bg-white/[0.07] font-medium" } as const;

function Cell({ col, row }: { col: ReportColumn; row: ReportRow }) {
  const v = row.cells[col.key] ?? null, href = row.links?.[col.key];
  const body = v === null || v === "" ? row.style ? null : <span className="text-[var(--ds-on-surface-muted)]">-</span>
    : col.kind === "money" ? <Money paise={Number(v)} fixed={false} />
    : col.kind === "date" ? <>{shortDate(String(v))}</>
    : col.kind === "mono" ? <span className="font-mono text-xs">{String(v)}</span> : <>{String(v)}</>;
  return href && v !== null ? <Link href={href} className={cn(LINK, "no-underline hover:underline")}>{body}</Link> : body;
}

/** A statement as a table: the same Report the CSV and PDF are written from. Figures with a link open the ledger or the entry behind them. */
export function ReportView({ report, caption }: { report: Report; caption?: string }) {
  return (
    <div className="flex flex-col gap-3">
      {report.warning ? (
        <p role="alert" className="flex items-start gap-2 rounded-2xl bg-[var(--ds-color-danger-500)]/10 p-4 text-sm text-[var(--ds-color-danger-300)]"><IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{report.warning}</p>
      ) : null}
      <div className="custom-scrollbar max-h-[75vh] overflow-auto rounded-2xl bg-white/[0.03]">
        <table className="w-full min-w-[560px] text-sm">
          <caption className="sr-only">{caption ?? report.title}</caption>
          <thead className="sticky top-0 z-10 bg-[var(--ds-surface-container-high)]">
            <tr>{report.columns.map((c) => <th key={c.key} scope="col" className={cn("px-4 py-3 font-mono text-[11px] font-normal uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]", c.kind === "money" ? "text-right" : "text-left")}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {report.rows.map((row, i) => (
              <tr key={i} className={cn("transition-colors", row.style ? ROW_STYLE[row.style] : "hover:bg-white/[0.04]")}>
                {report.columns.map((c) => <td key={c.key} className={cn("px-4 py-2.5 align-top", c.kind === "money" && "text-right")}><Cell col={c} row={row} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report.notes?.map((n) => <p key={n} className="text-xs text-[var(--ds-on-surface-muted)]">{n}</p>)}
    </div>
  );
}
