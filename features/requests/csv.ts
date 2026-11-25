// The queue as a spreadsheet: the same list, the same visibility, the same filters as the screen. Families get none.
import { AppError, ForbiddenError, listQueryFrom } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { fileResponse, isFamily } from "@smw/feature-messages/core";
import { REQUEST_STATE_WORDS } from "./constants";
import { RequestService, type RequestRow } from "./service";

/** A cell a spreadsheet will not run as a formula: a leading = + - @ gets an apostrophe. */
export const csvCell = (v: unknown) => {
  let s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const COLUMNS: { label: string; value: (r: RequestRow) => unknown }[] = [
  { label: "Number", value: (r) => r.number }, { label: "Title", value: (r) => r.subject }, { label: "Category", value: (r) => r.categoryName },
  { label: "Child", value: (r) => r.studentName }, { label: "Class", value: (r) => r.className }, { label: "State", value: (r) => REQUEST_STATE_WORDS[r.state] },
  { label: "Owner", value: (r) => r.ownerName }, { label: "Raised", value: (r) => r.createdAt }, { label: "Due", value: (r) => (r.paused ? "waiting for family" : r.dueAt) },
  { label: "Overdue", value: (r) => (r.overdue ? "yes" : "no") }, { label: "Level", value: (r) => r.level },
];

export async function requestsCsv(req: Request): Promise<Response> {
  try {
    const ctx = await actionCtx();
    if (isFamily(ctx.role)) throw new ForbiddenError("Only the school can download this list.");
    const svc = new RequestService(ctx);
    const query = listQueryFrom(Object.fromEntries(new URL(req.url).searchParams));
    const line = (cells: unknown[]) => `${cells.map(csvCell).join(",")}\r\n`;
    let page = await svc.list({ ...query, page: 1, pageSize: 100 }), n = 1;
    let out = `\uFEFF${line(COLUMNS.map((c) => c.label))}`;
    for (;;) {
      out += page.rows.map((r) => line(COLUMNS.map((c) => c.value(r)))).join("");
      if (n >= page.pageCount) break;
      page = await svc.list({ ...query, page: ++n, pageSize: 100 });
    }
    return new Response(out, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="requests.csv"', "cache-control": "private, no-store" } });
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

/** One file of a request, sent from here (no-store, with its download headers), only if this person may see it. */
export async function requestFile(_req: Request, p: { id: string; fileId: string }): Promise<Response> {
  try {
    return fileResponse(await new RequestService(await actionCtx()).file(p.id, p.fileId));
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
