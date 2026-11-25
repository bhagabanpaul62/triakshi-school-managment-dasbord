import { MessageService } from "@smw/feature-messages/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { idOf, linkOf, type IdParams } from "../../../_lib";

/** GET /api/v1/files/messages/{id}: { url, name, expiresIn } for a file in a conversation I am in. 404 for anyone else. */
export const GET = apiHandler(async (req, c: IdParams) => {
  const { url, name } = await new MessageService(await bearerCtx(req)).fileLink(await idOf(c));
  return linkOf(url, name);
});
