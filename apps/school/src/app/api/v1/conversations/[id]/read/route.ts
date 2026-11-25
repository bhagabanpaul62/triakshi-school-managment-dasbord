import { MessageService } from "@smw/feature-messages/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { idOf, type IdParams } from "../../../_lib";

/** POST /api/v1/conversations/{id}/read: mark the newest messages read (the same as opening it). Returns { ok: true }. */
export const POST = apiHandler(async (req, c: IdParams) => {
  const id = await idOf(c);
  await new MessageService(await bearerCtx(req)).thread(id);
  return { ok: true };
});
