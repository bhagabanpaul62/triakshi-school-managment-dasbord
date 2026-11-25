import { FeedService } from "@smw/feature-announcements/feed-service";
import { feedInput } from "@smw/feature-announcements/inputs";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { queryOf } from "../_lib";

/** GET /api/v1/notices?tab=inbox|archive&page&pageSize&q&category: the notices sent to the signed-in person, answers-needed first, with `unread`. */
export const GET = apiHandler(async (req) => new FeedService(await bearerCtx(req)).feed(queryOf(req, feedInput)));
