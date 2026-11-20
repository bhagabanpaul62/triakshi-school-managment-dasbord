import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { AcademicsExportService } from "../service";

/** GET /app/academics/classes/export: this year's class and section list as CSV. */
export async function GET() {
  try {
    const { csv, fileName } = await new AcademicsExportService(await actionCtx()).classListCsv();
    return new Response(`\uFEFF${csv}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${fileName}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
