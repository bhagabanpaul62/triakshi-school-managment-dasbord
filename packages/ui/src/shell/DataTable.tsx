"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { IconChevronLeft, IconChevronRight, IconSearch } from "@tabler/icons-react";
import { cn } from "../lib/utils";
import { initials, paise, shortDate } from "../lib/format";
import { ToneBadge, type Tone } from "../components/dashboard/widgets/WidgetPrimitives";
import { StateBadge } from "../components/finance/StateBadge";

/**
 * How a value renders, chosen by its type (kit rule 12). Columns are plain data, so server pages can pass them.
 * - person: value is the name; `metaKey` adds a second line; avatar initials on the left
 * - badge: value is a status; `tones` maps each value to a tone; `labels` renames it
 * - state: a finance state (paid, overdue, pending...), one badge map for every screen
 * - money: integer paise, right-aligned · date: short absolute · number: right-aligned tabular
 */
export type Column = {
  key: string;
  label: string;
  type?: "text" | "person" | "badge" | "state" | "money" | "date" | "number" | "mono";
  metaKey?: string;
  tones?: Record<string, Tone>;
  labels?: Record<string, string>;
  hideOnMobile?: boolean;
  width?: string;
};

export type FilterDef = { key: string; label: string; options: { value: string; label: string }[] };

export interface DataTableProps {
  columns: Column[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pageCount: number;
  /** `/app/list/students/{id}`: `{id}` and other `{key}`s are filled from the row. */
  rowHref?: string;
  searchPlaceholder?: string;
  filters?: FilterDef[];
  empty: { title: string; description: string; action?: ReactNode };
  /** Per-row actions (edit, delete) rendered on the right. Keyed by row id. */
  rowActions?: Record<string, ReactNode>;
  /** A first cell per row (a checkbox), keyed by row id, with its header cell. */
  leading?: { header: ReactNode; cells: Record<string, ReactNode> };
  toolbar?: ReactNode;
  /** false for short fixed lists (a ledger's installments): hides search, filters and the total. */
  searchable?: boolean;
}

const fill = (tpl: string, row: Record<string, unknown>) => tpl.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(row[k] ?? "")));
const right = (t?: Column["type"]) => t === "money" || t === "number";

function Cell({ col, row }: { col: Column; row: Record<string, unknown> }) {
  const v = row[col.key];
  if (v == null || v === "") return <span className="text-[var(--ds-on-surface-muted)]">-</span>;
  switch (col.type) {
    case "state": return <StateBadge state={String(v)} />;
    case "person": {
      const meta = col.metaKey ? row[col.metaKey] : null;
      return (
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-[11px]">{initials(String(v))}</span>
          <span className="min-w-0">
            <span className="block truncate text-[var(--ds-on-surface)]" title={String(v)}>{String(v)}</span>
            {meta ? <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{String(meta)}</span> : null}
          </span>
        </span>
      );
    }
    case "badge": return <ToneBadge label={col.labels?.[String(v)] ?? String(v).replace(/_/g, " ")} tone={col.tones?.[String(v)] ?? "default"} />;
    case "money": return <span className="tabular-nums">{paise(Number(v))}</span>;
    case "date": return <span className="whitespace-nowrap">{shortDate(v as string)}</span>;
    case "number": return <span className="tabular-nums">{Number(v).toLocaleString("en-IN")}</span>;
    case "mono": return <span className="font-mono text-xs">{String(v)}</span>;
    default: return <span className="block max-w-[28ch] truncate" title={String(v)}>{String(v)}</span>;
  }
}

/** URL-driven list: search, filters and page live in the query string, so the server page re-renders with the data. */
export function DataTable({ columns, rows, total, page, pageCount, rowHref, searchPlaceholder = "Search", filters = [], empty, rowActions, leading, toolbar, searchable = true }: DataTableProps) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const first = useRef(true);

  const go = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    if (!("page" in patch)) next.delete("page");
    start(() => router.replace(`${path}?${next.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => go({ q: q.trim() || undefined }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <section className="rounded-3xl bg-[var(--ds-surface-container-low)] p-4 sm:p-6" aria-busy={pending}>
      {searchable ? <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-white/[0.05] px-4 sm:max-w-xs">
          <IconSearch className="h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden />
          <span className="sr-only">{searchPlaceholder}</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--ds-on-surface-muted)]" />
        </label>
        {filters.map((f) => (
          <label key={f.key} className="flex h-10 items-center rounded-full bg-white/[0.05] px-4 text-sm">
            <span className="sr-only">{f.label}</span>
            <select value={params.get(f.key) ?? ""} onChange={(e) => go({ [f.key]: e.target.value || undefined })} className="bg-transparent outline-none">
              <option value="">{f.label}: all</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        ))}
        <span className="ml-auto text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{total.toLocaleString("en-IN")} total</span>
        {toolbar}
      </div> : toolbar ? <div className="mb-4 flex justify-end">{toolbar}</div> : null}

      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl bg-white/[0.035] p-6">
          <p className="text-sm text-[var(--ds-on-surface)]">{params.get("q") ? `Nothing matches "${params.get("q")}".` : empty.title}</p>
          <p className="text-xs text-[var(--ds-on-surface-muted)]">{params.get("q") ? "Try a different search or clear the filters." : empty.description}</p>
          {params.get("q") ? null : empty.action}
        </div>
      ) : (
        // relative: the sr-only Actions header is absolutely positioned; without a positioned ancestor here it escapes the scroll box and widens the whole page on phones.
        <div className={cn("custom-scrollbar relative -mx-4 overflow-x-auto sm:-mx-6 transition-opacity", pending && "opacity-60")}>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr>
                {leading ? <th className="w-px pl-4 sm:pl-6">{leading.header}</th> : null}
                {columns.map((c) => (
                  <th key={c.key} scope="col" style={c.width ? { width: c.width } : undefined}
                    className={cn("px-4 pb-3 font-mono text-[11px] font-normal uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)] first:pl-4 sm:first:pl-6", right(c.type) ? "text-right" : "text-left", c.hideOnMobile && "hidden md:table-cell")}>
                    {c.label}
                  </th>
                ))}
                {rowActions ? <th className="w-px pr-4 sm:pr-6"><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = String(row.id ?? "");
                const href = rowHref ? fill(rowHref, row) : null;
                return (
                  <tr key={id} className="group transition-colors duration-150 hover:bg-white/[0.04]">
                    {leading ? <td className="w-px pl-4 sm:pl-6">{leading.cells[id]}</td> : null}
                    {columns.map((c, i) => (
                      <td key={c.key} className={cn("px-4 py-3 first:pl-4 sm:first:pl-6", right(c.type) && "text-right", c.hideOnMobile && "hidden md:table-cell")}>
                        {href && i === 0 ? <Link href={href} className="block rounded focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]"><Cell col={c} row={row} /></Link> : <Cell col={c} row={row} />}
                      </td>
                    ))}
                    {rowActions ? <td className="whitespace-nowrap py-2 pr-4 text-right sm:pr-6">{rowActions[id]}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 ? (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-end gap-2 text-xs text-[var(--ds-on-surface-muted)]">
          <span className="tabular-nums">Page {page} of {pageCount}</span>
          <button disabled={page <= 1} onClick={() => go({ page: String(page - 1) })} aria-label="Previous page" title="Previous page" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] disabled:opacity-40"><IconChevronLeft className="h-4 w-4" /></button>
          <button disabled={page >= pageCount} onClick={() => go({ page: String(page + 1) })} aria-label="Next page" title="Next page" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] disabled:opacity-40"><IconChevronRight className="h-4 w-4" /></button>
        </nav>
      ) : null}
    </section>
  );
}
