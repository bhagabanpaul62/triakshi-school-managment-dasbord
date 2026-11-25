import { MeetingService } from "@smw/feature-meetings/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { listQueryOf } from "../_lib";

/** GET /api/v1/meetings?page&pageSize&q&state: parent-teacher meetings this person may see; `mine` is a family's own booked count. */
export const GET = apiHandler(async (req) => new MeetingService(await bearerCtx(req)).list(listQueryOf(req)));
