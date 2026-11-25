import { z } from "zod";
import { MessageService } from "@smw/feature-messages/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { idOf, queryOf, type IdParams } from "../../_lib";

const threadQuery = z.object({ before: z.string().max(100).optional() });

/** GET /api/v1/conversations/{id}?before: one conversation, newest messages last. Opening it marks what it shows as read. 404 unless the caller is a member. */
export const GET = apiHandler(async (req, c: IdParams) => {
  const id = await idOf(c);
  return new MessageService(await bearerCtx(req)).thread(id, queryOf(req, threadQuery));
});
