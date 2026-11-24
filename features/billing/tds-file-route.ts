import { BillingService } from "@smw/billing";
import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";

/** GET /app/billing/tds/:id: sends the school to a short-lived link to its own certificate. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = await new BillingService(await actionCtx()).tdsFileUrl(id);
    return Response.redirect(url, 302);
  } catch (err) {
    if (err instanceof AppError) return new Response(err.message, { status: err.status });
    throw err;
  }
}
