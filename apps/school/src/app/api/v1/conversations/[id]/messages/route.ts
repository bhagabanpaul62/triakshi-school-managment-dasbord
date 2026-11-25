import { MessageService } from "@smw/feature-messages/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { idOf, readBody, type IdParams } from "../../../_lib";
import { sendBody } from "../../../_schemas";

/** POST /api/v1/conversations/{id}/messages { body, clientId? }: reply. A retry with the same `clientId` returns the first message, never a second. Files: multipart, see `readBody`. */
export const POST = apiHandler(async (req, c: IdParams) => {
  const id = await idOf(c);
  const { data: { body, clientId }, files } = await readBody(req, sendBody);
  return new MessageService(await bearerCtx(req)).send(id, body, { clientId, files });
});
