import { startInput } from "@smw/feature-messages/inputs";
import { MessageService } from "@smw/feature-messages/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { queryOf, readBody } from "../_lib";
import { inboxQuery } from "../_schemas";

/** GET /api/v1/conversations?view&studentId&q&cursor: { rows, next, unread }. Pass `next` back as `cursor` for the following page. */
export const GET = apiHandler(async (req) => new MessageService(await bearerCtx(req)).inbox(queryOf(req, inboxQuery)));

/** POST /api/v1/conversations { studentId?, recipientIds[], subject, body, clientId? }: start one and send its first message. Returns { id }. Files: multipart, see `readBody`. */
export const POST = apiHandler(async (req) => {
  const { data, files } = await readBody(req, startInput);
  return new MessageService(await bearerCtx(req)).start(data, files);
});
