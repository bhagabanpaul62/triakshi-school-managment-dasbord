import { RequestService } from "@smw/feature-requests/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { raiseInput } from "@smw/feature-requests/inputs";
import { listQueryOf, readBody } from "../_lib";

/** GET /api/v1/requests?page&pageSize&q&state&category&view: the requests this person may see, as a page. `view` (mine, unassigned, team, overdue, all) is for staff. */
export const GET = apiHandler(async (req) => new RequestService(await bearerCtx(req)).list(listQueryOf(req)));

/** POST /api/v1/requests { categoryId, subject, details, studentId?, values?, aboutUserIds? }: a family asks, or the office writes one down. Returns { id, number }. Files: multipart, see `readBody`. */
export const POST = apiHandler(async (req) => {
  const { data, files } = await readBody(req, raiseInput);
  return new RequestService(await bearerCtx(req)).raise(data, files);
});
