import { ResultService } from "@smw/feature-exams/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";

/** GET /api/v1/results: published results of the student, or of each of a parent's children. */
export const GET = apiHandler(async (req) => ({ results: await new ResultService(await bearerCtx(req)).mine() }));
