import { TdsService } from "@smw/billing";
import { AppError } from "@smw/feature-kit";
import { staffActionCtx } from "@smw/runtime/console";

export const dynamic = "force-dynamic";

/** GET /billing/tds/:id/file: staff are sent to a short-lived link to the school's certificate. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.redirect(await new TdsService(await staffActionCtx()).fileUrl((await params).id), 302);
  } catch (err) {
    if (err instanceof AppError) return new Response(err.message, { status: err.status });
    throw err;
  }
}
