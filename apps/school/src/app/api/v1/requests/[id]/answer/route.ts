import { isFamily } from "@smw/feature-messages/core";
import { RequestService } from "@smw/feature-requests/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { idOf, readBody, type IdParams } from "../../../_lib";
import { answerBody } from "../../../_schemas";

/** POST /api/v1/requests/{id}/answer { body }: staff answer the family; a family login writes back to the school. Returns { ok: true }. Files: multipart, see `readBody`. */
export const POST = apiHandler(async (req, c: IdParams) => {
  const id = await idOf(c);
  const ctx = await bearerCtx(req);
  const { data: { body }, files } = await readBody(req, answerBody);
  const svc = new RequestService(ctx);
  await (isFamily(ctx.role) ? svc.reply(id, body, files) : svc.answer(id, body, files));
  return { ok: true };
});
