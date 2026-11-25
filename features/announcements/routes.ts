// Route handlers for the notice downloads. In an app route file: `export const GET = circularRoute;` (import from "@smw/feature-announcements/routes").
// Each service checks that the caller may see the thing; a refusal is a short JSON message with its status.
import { AppError } from "@smw/feature-kit";
import { csvResponse, fileResponse, pdfResponse, sniffType } from "@smw/integrations";
import { actionCtx } from "@smw/runtime";
import { CircularService } from "./circular-pdf";
import { NoticeFileService } from "./files";
import { ReportService } from "./report-service";

type Ctx = Awaited<ReturnType<typeof actionCtx>>;
type Params = { params: Promise<Record<string, string>> };

async function serve(make: (ctx: Ctx, p: Record<string, string>, url: URL) => Promise<Response>, req: Request, p: Params) {
  try { return await make(await actionCtx(), await p.params, new URL(req.url)); }
  catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
const pdf = (f: { bytes: Uint8Array; fileName: string }) => pdfResponse(f.bytes, f.fileName);
/** /api/notices/[id]/circular */
export const circularRoute = (req: Request, p: Params) => serve(async (c, q) => pdf(await new CircularService(c).pdf(q.id!)), req, p);
/** /api/notices/register?session=2026-27 */
export const registerRoute = (req: Request, p: Params) => serve(async (c, _q, u) => pdf(await new CircularService(c).registerPdf(u.searchParams.get("session") ?? undefined)), req, p);
/** /api/notices/[id]/report.csv */
export const reportCsvRoute = (req: Request, p: Params) => serve(async (c, q) => {
  const f = await new ReportService(c).csv(q.id!);
  return csvResponse(f.csv, f.fileName);
}, req, p);
/** /api/notices/[id]/sign-sheet */
export const signSheetRoute = (req: Request, p: Params) => serve(async (c, q) => pdf(await new ReportService(c).signSheetPdf(q.id!)), req, p);
/** /api/notices/[id]/slip/[recipientId]: the picture of a paper answer. */
export const slipRoute = (req: Request, p: Params) => serve(async (c, q) => {
  const bytes = await new ReportService(c).slip(q.id!, q.recipientId!);
  return fileResponse({ bytes, type: sniffType(bytes) ?? "application/octet-stream", name: "slip" });
}, req, p);
/** /api/notices/files/[fileId]: a file on a notice. */
export const fileRoute = (req: Request, p: Params) => serve(async (c, q) => { const f = await new NoticeFileService(c).bytes(q.fileId!); return fileResponse({ bytes: f.bytes, type: f.contentType, name: f.name }); }, req, p);
