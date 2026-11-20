import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { AdmitCardService } from "../service";

type Params = { params: Promise<{ id: string; studentId?: string; sectionId?: string }> };

async function pdfResponse(make: () => Promise<{ filename: string; bytes: Uint8Array }>) {
  try {
    const { filename, bytes } = await make();
    return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${filename}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new Response(e.message, { status: e.status });
    throw e;
  }
}

/** GET /app/exams/[id]/admit-card/[studentId]: one student's admit card. */
export async function GET(_req: Request, { params }: Params) {
  const { id: examId, studentId } = await params;
  return pdfResponse(async () => new AdmitCardService(await actionCtx()).pdf(examId, String(studentId)));
}

/** GET /app/exams/[id]/admit-cards/[sectionId]: a whole section in one PDF. */
export async function GET_BATCH(_req: Request, { params }: Params) {
  const { id: examId, sectionId } = await params;
  return pdfResponse(async () => new AdmitCardService(await actionCtx()).classBatch(examId, String(sectionId)));
}
