import { receiptRoute } from "./document-routes";

/** GET /app/fees/receipts/[paymentId]: the receipt PDF (kept at its old address; the service checks the caller may see it and logs the print). */
export const GET = receiptRoute;
