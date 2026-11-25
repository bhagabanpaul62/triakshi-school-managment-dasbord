// The queue as a spreadsheet: the same list, the same visibility, the same filters as the screen. Families get none.
import { AppError, ForbiddenError, listQueryFrom } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { csvLine, csvResponse, fileResponse } from "@smw/integrations";
import { isFamily } from "@smw/feature-messages/core";
import { REQUEST_STATE_WORDS } from "./constants";
import { RequestService, type RequestRow } from "./service";

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
        let page = await svc.list({ ...query, page: 1, pageSize: 100 }), n = 1;
    let out = csvLine(COLUMNS.map((c) => c.label));
    for (;;) {
      out += page.rows.map((r) => csvLine(COLUMNS.map((c) => c.value(r)))).join("");
      if (n >= page.pageCount) break;
      page = await svc.list({ ...query, page: ++n, pageSize: 100 });
    }
    return csvResponse(out, "requests.csv");
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
