// Route handlers for the fee PDFs. In an app route file: `export const GET = invoiceRoute;` (import it from "@smw/feature-fees/document-routes").
import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { CertificateService } from "./certificates";
import { InvoiceService } from "./invoices";
import { ReceiptService } from "./receipts";
import { RefundService } from "./refunds";

type File = { filename: string; bytes: Uint8Array };
type Ctx = Awaited<ReturnType<typeof actionCtx>>;
type Params = { params: Promise<Record<string, string>> };

/** Serve a PDF; the service checks the caller may see this document. A refusal is a short JSON message with its status. */
async function serve(make: (ctx: Ctx, params: Record<string, string>, url: URL) => Promise<File>, req: Request, p: Params) {
  try {
    const { filename, bytes } = await make(await actionCtx(), await p.params, new URL(req.url));
    return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${filename}"`, "cache-control": "private, no-store" } });
  } catch (err) {
    if (err instanceof AppError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

const idsOf = (u: URL) => (u.searchParams.get("ids") ?? "").split(",").filter(Boolean);

/** /app/fees/receipts/[id]/file */
export const receiptRoute = (req: Request, p: Params) => serve((c, q) => new ReceiptService(c).receiptFile(q.id ?? q.paymentId!), req, p);
/** /app/fees/receipts/print?ids=a,b: up to 100 receipts as one PDF, each logged as a print. */
export const receiptsRoute = (req: Request, p: Params) => serve((c, _q, u) => new ReceiptService(c).receiptsFile(idsOf(u)), req, p);
/** /app/fees/invoices/print?ids=a,b: up to 100 bills as one PDF. */
export const invoicesRoute = (req: Request, p: Params) => serve((c, _q, u) => new InvoiceService(c).invoicesFile(idsOf(u)), req, p);
/** /app/fees/invoices/[id]/file */
export const invoiceRoute = (req: Request, p: Params) => serve((c, q) => new InvoiceService(c).invoiceFile(q.id!), req, p);
/** /app/fees/students/[studentId]/statement?from=&to= */
export const statementRoute = (req: Request, p: Params) => serve((c, q, u) => new CertificateService(c).statementFile(q.studentId!, { from: u.searchParams.get("from") ?? undefined, to: u.searchParams.get("to") ?? undefined }), req, p);
/** /app/fees/students/[studentId]/tuition-certificate?fy=2026-27 */
export const tuitionCertificateRoute = (req: Request, p: Params) => serve((c, q, u) => new CertificateService(c).certificateFile(q.studentId!, u.searchParams.get("fy") ?? undefined), req, p);
/** /app/fees/students/[studentId]/no-dues */
export const noDuesRoute = (req: Request, p: Params) => serve((c, q) => new CertificateService(c).noDuesFile(q.studentId!), req, p);
/** /app/fees/refunds/[id]/voucher */
export const refundVoucherRoute = (req: Request, p: Params) => serve((c, q) => new RefundService(c).refundVoucherFile(q.id!), req, p);
