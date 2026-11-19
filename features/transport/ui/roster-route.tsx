import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { StudentTransportService } from "../service";

/** GET /app/transport/routes/{id}/roster: the route list as a PDF. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { bytes, fileName } = await new StudentTransportService(await actionCtx()).rosterPdf(id);
    return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${fileName}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
