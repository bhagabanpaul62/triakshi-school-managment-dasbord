import { ConsoleBillingService } from "@smw/billing";
import { AppError } from "@smw/feature-kit";
import { staffActionCtx } from "@smw/runtime/console";

export const dynamic = "force-dynamic";

/** GET /billing/invoices/:id/pdf for signed-in staff. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const pdf = await new ConsoleBillingService(await staffActionCtx()).invoicePdf((await params).id);
    return new Response(Buffer.from(pdf.bytes), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${pdf.filename}"`, "cache-control": "private, no-store" } });
  } catch (err) {
    if (err instanceof AppError) return new Response(err.message, { status: err.status });
    throw err;
  }
}
