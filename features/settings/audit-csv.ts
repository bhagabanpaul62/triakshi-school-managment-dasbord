// The audit log as a spreadsheet: the same filters as the screen, newest first, at most 50,000 rows, streamed so a big log never sits in memory.
import { AppError, listQueryFrom } from "@smw/feature-kit";
import { csvLine } from "@smw/integrations";
import { actionCtx } from "@smw/runtime";
import { AuditService } from "./audit-service";

const HEAD = ["When (IST)", "Area", "Action", "Thing", "Record id", "What happened", "Who", "Through support", "From"];

export async function auditCsv(req: Request): Promise<Response> {
  try {
    const svc = new AuditService(await actionCtx());
    const query = listQueryFrom(Object.fromEntries(new URL(req.url).searchParams));
    const chunks = svc.csvChunks(query);
    // The first chunk is fetched before the response starts, so a refusal (not an admin) is a proper error and not a half file.
    let queued: Awaited<ReturnType<typeof chunks.next>> | null = await chunks.next();
    const ist = (d: Date) => d.toLocaleString("en-CA", { timeZone: "Asia/Kolkata", hour12: false }).replace(",", "");
    const body = new ReadableStream<Uint8Array>({
      async start(c) { c.enqueue(new TextEncoder().encode(`\uFEFF${csvLine(HEAD)}`)); },
      async pull(c) {
        const next = queued ?? await chunks.next();
        queued = null;
        if (next.done) { c.close(); return; }
        c.enqueue(new TextEncoder().encode(next.value.map((r) => csvLine([ist(r.createdAt), r.module, r.action, r.entity, r.entityId, r.summary, r.actor, r.support ? "yes" : "no", r.ip])).join("")));
      },
    });
    return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="audit-log.csv"', "cache-control": "private, no-store" } });
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
