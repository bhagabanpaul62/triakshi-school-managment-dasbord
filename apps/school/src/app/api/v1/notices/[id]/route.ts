import { z } from "zod";
import { FeedService } from "@smw/feature-announcements/feed-service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { idOf, queryOf, type IdParams } from "../../_lib";

const openQuery = z.object({ lang: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "Not a language code").optional() });

/** GET /api/v1/notices/{id}?lang: one notice sent to me. Opening it marks it seen. 404 for a notice that was not sent to this person. */
export const GET = apiHandler(async (req, c: IdParams) => {
  const id = await idOf(c);
  return new FeedService(await bearerCtx(req)).open(id, queryOf(req, openQuery));
});
