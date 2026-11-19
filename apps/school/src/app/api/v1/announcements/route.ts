import { AnnouncementService } from "@smw/feature-announcements/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { listQueryOf } from "../_lib";

/** GET /api/v1/announcements?page&pageSize&q: what the signed-in role may see, newest first. */
export const GET = apiHandler(async (req) => new AnnouncementService(await bearerCtx(req)).list(listQueryOf(req)));
