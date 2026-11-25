import { isFamily } from "@smw/feature-messages/core";
import { BookingService, MeetingService } from "@smw/feature-meetings/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { idOf, type IdParams } from "../../_lib";

/** GET /api/v1/meetings/{id}: a family gets its booking page (teachers, free times, own bookings, `can`/`why`); staff get the windows and slots. */
export const GET = apiHandler(async (req, c: IdParams) => {
  const id = await idOf(c);
  const ctx = await bearerCtx(req);
  return isFamily(ctx.role) ? new BookingService(ctx).forFamily(id) : new MeetingService(ctx).get(id);
});
