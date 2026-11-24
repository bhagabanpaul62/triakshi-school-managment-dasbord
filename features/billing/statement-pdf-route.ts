import { BillingService } from "@smw/billing";
import { AppError } from "@smw/feature-kit";
import { todayIST } from "@smw/feature-kit/money";
import { actionCtx } from "@smw/runtime";
import { parsePeriod } from "@smw/ui/finance/logic";

/** GET /app/billing/statement/pdf?period=...: the same period params the Statement tab uses. */
export async function GET(req: Request) {
  try {
    const sp = new URL(req.url).searchParams;
    const period = parsePeriod({ period: sp.get("period"), from: sp.get("from"), to: sp.get("to") }, todayIST());
    const pdf = await new BillingService(await actionCtx()).statementPdf(period);
    return new Response(Buffer.from(pdf.bytes), {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${pdf.filename}"`, "cache-control": "private, no-store" },
    });
  } catch (err) {
    if (err instanceof AppError) return new Response(err.message, { status: err.status });
    throw err;
  }
}
