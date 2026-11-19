import { BillingService } from "@smw/billing";
import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";

/** GET /app/billing/invoices/:id/pdf. The service checks the school and the role; another school's invoice is a 404. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const pdf = await new BillingService(await actionCtx()).invoicePdf(id);
    return new Response(Buffer.from(pdf.bytes), {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${pdf.filename}"`, "cache-control": "private, no-store" },
    });
  } catch (err) {
    if (err instanceof AppError) return new Response(err.message, { status: err.status });
    throw err;
  }
}
