import { DuesService } from "@smw/feature-fees/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { listQueryOf } from "../../_lib";

/** GET /api/v1/fees/dues: a student's or parent's children's dues (paise); staff with fee access get the dues report (paged). */
export const GET = apiHandler(async (req) => {
  const ctx = await bearerCtx(req);
  const svc = new DuesService(ctx);
  return ctx.role === "student" || ctx.role === "parent" ? { dues: await svc.mine() } : svc.duesReport(listQueryOf(req));
});
