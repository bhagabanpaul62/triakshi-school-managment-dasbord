import { MessageService } from "@smw/feature-messages/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";

/** GET /api/v1/messages/threads: the signed-in user's conversations, newest activity first, with unread counts. */
export const GET = apiHandler(async (req) => new MessageService(await bearerCtx(req)).inbox());
