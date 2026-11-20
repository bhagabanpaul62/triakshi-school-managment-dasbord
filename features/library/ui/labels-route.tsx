import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { BookService } from "../service";

/** GET /app/library/labels?book={id} or ?from=12&to=40: an A4 sheet of accession labels. */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const bytes = await new BookService(await actionCtx()).labelsPdf({ bookId: q.get("book") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined });
    return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="accession-labels.pdf"', "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
