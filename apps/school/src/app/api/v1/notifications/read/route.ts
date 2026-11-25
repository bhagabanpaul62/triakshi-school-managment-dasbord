import { NotificationService } from "@smw/feature-notifications/service";
import { apiHandler, bearerCtx, readJson } from "@smw/runtime/bearer";
import { readBody } from "../../_schemas";

/** POST /api/v1/notifications/read { id } or { all: true }: returns { updated }. Someone else's id changes nothing. */
export const POST = apiHandler(async (req) => {
  const b = await readJson(req, readBody);
  return new NotificationService(await bearerCtx(req)).markRead(b.all ? "all" : b.id!);
});
