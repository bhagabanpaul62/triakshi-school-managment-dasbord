import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { PaymentService } from "./service";

/** GET /app/fees/receipts/[paymentId]: the receipt PDF. The service checks the caller may see this payment. */
export async function GET(_req: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  try {
    const { paymentId } = await params;
    const { filename, bytes } = await new PaymentService(await actionCtx()).receiptFile(paymentId);
    return new Response(Buffer.from(bytes), {
      headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${filename}"`, "cache-control": "private, no-store" },
    });
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
