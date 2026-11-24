import { AppError, listQueryFrom, type Page } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { csvCell } from "./payments";

export interface CsvColumn<R> { label: string; value: (row: R) => unknown }

/** A cell that a spreadsheet will not run as a formula: a leading = + - @ gets an apostrophe. */
export { csvCell };

/** Pages through a list service (100 at a time, up to 5,000 rows) and answers with a CSV file. Same filters as the screen. */
export async function csvResponse<R>(req: Request, name: string, list: (query: ReturnType<typeof listQueryFrom>) => Promise<Page<R>>, columns: CsvColumn<R>[]) {
  try {
    const params = Object.fromEntries(new URL(req.url).searchParams);
    const rows: R[] = [];
    for (let page = 1; page <= 50; page++) {
      const r = await list({ ...listQueryFrom(params), page, pageSize: 100 });
      rows.push(...r.rows);
      if (page >= r.pageCount) break;
    }
    const body = [columns.map((c) => csvCell(c.label)).join(","), ...rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(","))].join("\r\n");
    return new Response(`${"\ufeff"}${body}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "private, no-store" } });
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
export { actionCtx };
