import { ResponseService } from "@smw/feature-announcements/response-service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { idOf, readBody, type IdParams } from "../../../_lib";
import { respondBody } from "../../../_schemas";

/** POST /api/v1/notices/{id}/respond: answer or change an answer until the last date. A question that asks for a file takes it as multipart part `file:<questionId>`. */
export const POST = apiHandler(async (req, c: IdParams) => {
  const noticeId = await idOf(c);
  const { data, byName } = await readBody(req, respondBody);
  return new ResponseService(await bearerCtx(req)).respond({ ...data, noticeId }, byName);
});
