import { AppError } from "@smw/feature-kit";
import { SupportDeskService } from "@smw/platform";
import { fileResponse } from "@smw/integrations";
import { staffActionCtx } from "@smw/runtime/console";

/** A ticket file for staff: checked as staff, then sent to a link that works for 60 seconds. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const svc = new SupportDeskService(await staffActionCtx());
    const { id } = await params;
    const f = await svc.fileUrl(id);
    if (f.url.startsWith("memory://")) { const b = await svc.fileBytes(id); return fileResponse({ bytes: b.bytes, type: b.contentType, name: b.name }); }
    return new Response(null, { status: 302, headers: { location: f.url, "cache-control": "private, no-store" } });
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
