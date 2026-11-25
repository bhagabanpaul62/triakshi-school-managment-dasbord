import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { DayService } from "./day";

type Params = { params: Promise<{ id: string }> };
const fail = (e: unknown) => {
  if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
};
const PDF = (bytes: Uint8Array, fileName: string) => new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${fileName}"`, "cache-control": "private, no-store" } });

/** GET /api/meetings/{id}/sheet?teacher=: one teacher's list on paper. */
export async function sheet(req: Request, { params }: Params) {
  try {
    const { id } = await params;
    const r = await new DayService(await actionCtx()).teacherSheetPdf(id, new URL(req.url).searchParams.get("teacher") ?? undefined);
    return PDF(r.bytes, r.fileName);
  } catch (e) { return fail(e); }
}

/** GET /api/meetings/{id}/room: who sits where and when. */
export async function room(_req: Request, { params }: Params) {
  try {
    const r = await new DayService(await actionCtx()).roomSheetPdf((await params).id);
    return PDF(r.bytes, r.fileName);
  } catch (e) { return fail(e); }
}

/** GET /api/meetings/{id}/not-came: families that did not come, as a spreadsheet. */
export async function notCame(_req: Request, { params }: Params) {
  try {
    const r = await new DayService(await actionCtx()).notCameCsv((await params).id);
    return new Response(r.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${r.fileName}"`, "cache-control": "private, no-store" } });
  } catch (e) { return fail(e); }
}
