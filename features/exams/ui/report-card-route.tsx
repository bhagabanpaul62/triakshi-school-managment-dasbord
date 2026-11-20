import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { ReportCardService } from "../service";

type Params = { params: Promise<{ examId: string; studentId?: string; sectionId?: string }> };

/** Download one student's report card: GET /app/results/[examId]/[studentId]/report-card. */
export async function GET(_req: Request, { params }: Params) {
  const { examId, studentId } = await params;
  return pdfResponse(async () => new ReportCardService(await actionCtx()).pdf({ examId }, String(studentId)));
}

/** Download a whole section's report cards in one PDF: GET /app/results/[examId]/batch/[sectionId]. */
export async function GET_BATCH(_req: Request, { params }: Params) {
  const { examId, sectionId } = await params;
  return pdfResponse(async () => new ReportCardService(await actionCtx()).classBatch(examId, String(sectionId)));
}

/** Download one student's term report card: GET /app/results/term/[termId]/[studentId]/report-card. */
export async function GET_TERM(_req: Request, { params }: { params: Promise<{ termId: string; studentId: string }> }) {
  const { termId, studentId } = await params;
  return pdfResponse(async () => new ReportCardService(await actionCtx()).termPdf(termId, studentId));
}

/** A whole section's term report cards in one PDF: GET /app/results/term/[termId]/batch/[sectionId]. */
export async function GET_TERM_BATCH(_req: Request, { params }: { params: Promise<{ termId: string; sectionId: string }> }) {
  const { termId, sectionId } = await params;
  return pdfResponse(async () => new ReportCardService(await actionCtx()).termBatch(termId, sectionId));
}

async function pdfResponse(make: () => Promise<{ filename: string; bytes: Uint8Array }>) {
  try {
    const { filename, bytes } = await make();
    return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${filename}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
}
