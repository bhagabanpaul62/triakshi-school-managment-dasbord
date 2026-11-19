import { TimetableService } from "@smw/feature-timetable/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";

/** GET /api/v1/timetable/today: today's periods for a teacher, or for a student's (or parent's children's) section. */
export const GET = apiHandler(async (req) => new TimetableService(await bearerCtx(req)).today());
