// A ready export, handed over from here and nowhere else: this checks settings:export, logs the download, and answers an old file in words.
import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { ExportService } from "./export-service";

const back = (error?: string) => new Response(null, { status: 302, headers: { location: `/app/settings/export${error ? `?error=${encodeURIComponent(error)}` : ""}`, "cache-control": "private, no-store" } });

export async function exportDownload(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { url } = await new ExportService(await actionCtx()).download((await params).id);
    return new Response(null, { status: 302, headers: { location: url, "cache-control": "private, no-store" } });
  } catch (err) {
    if (err instanceof AppError) return back(err.message);
    throw err;
  }
}
