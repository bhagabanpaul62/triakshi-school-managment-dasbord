import { FeedService } from "@smw/feature-announcements/feed-service";
import { ConflictError, NotFoundError } from "@smw/feature-kit";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { idOf, linkOf, type IdParams } from "../../../_lib";

/** GET /api/v1/files/notices/{id}: { url, name, expiresIn } for a file on a notice sent to me. A file that is missing or not mine is 404. */
export const GET = apiHandler(async (req, c: IdParams) => {
  const id = await idOf(c);
  const { url, name } = await new FeedService(await bearerCtx(req)).fileUrl(id).catch((e) => { throw e instanceof ConflictError ? new NotFoundError("File") : e; });
  return linkOf(url, name);
});
