import { AppError, listQueryFrom, type Page } from "@smw/feature-kit";
import { csvCell } from "@smw/ui/finance/logic";

export interface CsvColumn<R> { label: string; value: (row: R) => unknown }

/** Pages through a list (100 at a time, up to 5,000 rows) with the screen's own filters and answers with a CSV file. */
export async function csvResponse<R>(req: Request, name: string, list: (query: ReturnType<typeof listQueryFrom>) => Promise<Page<R>>, columns: CsvColumn<R>[]) {
  try {
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const rows: R[] = [];
    for (let page = 1; page <= 50; page++) {
      const r = await list({ ...listQueryFrom(params), page, pageSize: 100 });
      rows.push(...r.rows);
      if (page >= r.pageCount) break;
    }
    // A leading = + - @ would run as a formula in a spreadsheet; school names and references are typed by people.
    const safe = (v: unknown) => csvCell(typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
    const body = [columns.map((c) => safe(c.label)).join(","), ...rows.map((r) => columns.map((c) => safe(c.value(r))).join(","))].join("\r\n");
    return new Response(`﻿${body}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "private, no-store" } });
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
