import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { SubmissionService } from "./service";

/** GET /app/assignments/{id}/export: marks for the section as a CSV the teacher can open in a spreadsheet. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { fileName, csv } = await new SubmissionService(await actionCtx()).marksCsv(id);
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${fileName}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
