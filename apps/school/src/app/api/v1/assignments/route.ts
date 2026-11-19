import { AssignmentService, SelfService } from "@smw/feature-assignments/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { listQueryOf } from "../_lib";

/** GET /api/v1/assignments: open work first for a student or parent; staff get their assignment list (paged). */
export const GET = apiHandler(async (req) => {
  const ctx = await bearerCtx(req);
  return ctx.role === "student" || ctx.role === "parent" ? { assignments: await new SelfService(ctx).mine() } : new AssignmentService(ctx).listWithStats(listQueryOf(req));
});
