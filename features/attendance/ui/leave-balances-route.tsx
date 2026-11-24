import { AppError } from "@smw/feature-kit";
import { actionCtx } from "@smw/runtime";
import { LeaveBalanceService } from "../leave-balances";

/** GET /app/attendance/leave-balances/export: the balances table as CSV. */
export async function GET() {
  try {
    const { text, fileName } = await new LeaveBalanceService(await actionCtx()).csv();
    return new Response(text, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${fileName}"`, "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
