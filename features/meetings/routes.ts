import { AppError } from "@smw/feature-kit";
import { csvResponse, pdfResponse } from "@smw/integrations";
import { actionCtx } from "@smw/runtime";
import { DayService } from "./day";

type Params = { params: Promise<{ id: string }> };
const fail = (e: unknown) => {
  if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
};

/** GET /api/meetings/{id}/sheet?teacher=&date=: one teacher's list on paper. */
export async function sheet(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const q = new URL(req.url).searchParams;
    const r = await new DayService(await actionCtx()).teacherSheetPdf(id, q.get("teacher") ?? undefined, q.get("date") ?? undefined);
    return pdfResponse(r.bytes, r.fileName);
  } catch (e) { return fail(e); }
}

/** GET /api/meetings/{id}/room: who sits where and when. */
export async function room(_req: Request, { params }: Params) {
  try {
    const r = await new DayService(await actionCtx()).roomSheetPdf((await params).id);
    return pdfResponse(r.bytes, r.fileName);
  } catch (e) { return fail(e); }
}

/** GET /api/meetings/{id}/not-came: families that did not come, as a spreadsheet. */
export async function notCame(_req: Request, { params }: Params) {
  try {
    const r = await new DayService(await actionCtx()).notCameCsv((await params).id);
    return csvResponse(r.csv, r.fileName);
  } catch (e) { return fail(e); }
}
