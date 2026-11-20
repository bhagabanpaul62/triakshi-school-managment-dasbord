import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { weekPdf } from "../print";

const pdf = (kind: "section" | "teacher") => async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { bytes, fileName } = await weekPdf(await actionCtx(), kind, id);
    return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${fileName}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
};

/** GET /app/timetable/sections/{id}/print and /app/timetable/teachers/{id}/print: the week as an A4 PDF. */
export const sectionPrint = pdf("section");
export const teacherPrint = pdf("teacher");
