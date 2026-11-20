import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { AcademicsExportService } from "../service";

/** GET /app/academics/classes/allocation: section by subject, with the subject teacher, as an A4 PDF. */
export async function GET() {
  try {
    const { bytes, fileName } = await new AcademicsExportService(await actionCtx()).allocationPdf();
    return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${fileName}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
