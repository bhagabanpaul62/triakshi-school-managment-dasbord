import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { IncomeService, PaymentService } from "../service";

const pdf = (f: { filename: string; bytes: Uint8Array }) => new Response(Buffer.from(f.bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${f.filename}"`, "cache-control": "private, no-store" } });
const fail = (err: unknown) => { if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status }); throw err; };

/** GET /app/expenses/payments/[id]/voucher */
export async function voucher(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return pdf(await new PaymentService(await actionCtx()).voucherPdf((await params).id)); } catch (e) { return fail(e); }
}
/** GET /app/expenses/income/[id]/receipt */
export async function incomeReceipt(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return pdf(await new IncomeService(await actionCtx()).pdf((await params).id)); } catch (e) { return fail(e); }
}
/** GET /app/expenses/payments/bank-file?ids=a,b */
export async function bankFile(req: Request) {
  try {
    const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").filter(Boolean);
    const csv = await new PaymentService(await actionCtx()).bankFile(ids);
    return new Response(`${"\ufeff"}${csv}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="bank-file.csv"', "cache-control": "private, no-store" } });
  } catch (e) { return fail(e); }
}
