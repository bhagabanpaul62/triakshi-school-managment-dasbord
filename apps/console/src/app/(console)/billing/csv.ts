import { AppError, listQueryFrom, type Page } from "@smw/feature-kit";
import { csvCell } from "@smw/ui/finance/logic";

export interface CsvColumn<R> { label: string; value: (row: R) => unknown }

/** Pages through a list 100 rows at a time, with no cap, and streams a CSV file with the screen's own filters. */
export async function csvResponse<R>(req: Request, name: string, list: (query: ReturnType<typeof listQueryFrom>) => Promise<Page<R>>, columns: CsvColumn<R>[]) {
  try {
    const query = listQueryFrom(Object.fromEntries(new URL(req.url).searchParams));
    // A leading = + - @ would run as a formula in a spreadsheet; school names and references are typed by people.
    const safe = (v: unknown) => csvCell(typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
    const line = (cells: unknown[]) => `${cells.map(safe).join(",")}\r\n`;
    const enc = new TextEncoder();
    let page = await list({ ...query, page: 1, pageSize: 100 }), n = 1;
    const body = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        ctrl.enqueue(enc.encode(`${n === 1 ? `\ufeff${line(columns.map((c) => c.label))}` : ""}${page.rows.map((r) => line(columns.map((c) => c.value(r)))).join("")}`));
        if (n >= page.pageCount) return ctrl.close();
        page = await list({ ...query, page: ++n, pageSize: 100 });
      },
    });
    return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "private, no-store" } });
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
