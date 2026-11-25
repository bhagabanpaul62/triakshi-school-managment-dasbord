// Route handler for ticket files. In an app route file: `export const GET = fileRoute;` (import from "@smw/feature-support/routes").
// The service checks the ticket is this person's to see; the browser is sent to a link that works for 60 seconds.
import { AppError } from "@smw/feature-kit";
import { fileResponse } from "@smw/integrations";
import { actionCtx } from "@smw/runtime";
import { SupportService } from "./service";

/** /api/support/files/[id] */
export async function fileRoute(_req: Request, p: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const svc = new SupportService(await actionCtx());
    const { id } = await p.params;
    const f = await svc.fileUrl(id);
    // The in-memory store used in tests has no real links: serve the bytes instead.
    if (f.url.startsWith("memory://")) return fileResponse(await svc.fileBytes(id).then((b) => ({ bytes: b.bytes, type: b.contentType, name: b.name })));
    return new Response(null, { status: 302, headers: { location: f.url, "cache-control": "private, no-store" } });
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
