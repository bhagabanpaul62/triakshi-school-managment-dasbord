import { RequestService } from "@smw/feature-requests/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { idOf, type IdParams } from "../../_lib";

/** GET /api/v1/requests/{id}: the request with its conversation, timeline and what this person can do next (`can`). 404 for someone else's. */
export const GET = apiHandler(async (req, c: IdParams) => {
  const id = await idOf(c);
  return new RequestService(await bearerCtx(req)).get(id);
});
