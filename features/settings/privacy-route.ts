// One document of a privacy request, handed over from here: checks who is asking, logs it, and sends a 60-second link.
import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { PrivacyService } from "./privacy-service";

export async function privacyFile(_req: Request, { params }: { params: Promise<{ id: string; fileId: string }> }): Promise<Response> {
  try {
    const { id, fileId } = await params;
    const { url } = await new PrivacyService(await actionCtx()).fileLink(id, fileId);
    return new Response(null, { status: 302, headers: { location: url, "cache-control": "private, no-store" } });
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
