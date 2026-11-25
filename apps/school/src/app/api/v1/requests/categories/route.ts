import { CategoryService } from "@smw/feature-requests/categories";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";

/** GET /api/v1/requests/categories: what a request may be about, with the extra fields each one asks for (`values` in POST /requests). */
export const GET = apiHandler(async (req) => ({ rows: await new CategoryService(await bearerCtx(req)).options() }));
