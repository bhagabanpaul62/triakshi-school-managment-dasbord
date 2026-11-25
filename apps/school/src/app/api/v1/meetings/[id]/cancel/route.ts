import { BookingService } from "@smw/feature-meetings/service";
import { apiHandler, bearerCtx, readJson } from "@smw/runtime/bearer";
import { idOf, type IdParams } from "../../../_lib";
import { cancelBookingBody } from "../../../_schemas";

/** POST /api/v1/meetings/{id}/cancel { slotId, studentId? }: give back one booked time (the meeting itself stays). */
export const POST = apiHandler(async (req, c: IdParams) => {
  const id = await idOf(c);
  const body = await readJson(req, cancelBookingBody);
  return new BookingService(await bearerCtx(req)).cancelBooking(id, body);
});
