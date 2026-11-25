import { BookingService } from "@smw/feature-meetings/service";
import { apiHandler, bearerCtx, readJson } from "@smw/runtime/bearer";
import { idOf, type IdParams } from "../../../_lib";
import { changeBody } from "../../../_schemas";

/** POST /api/v1/meetings/{id}/change { fromSlotId, toSlotId, studentId? }: move a booking in one step; if the new time is gone the old one stays. */
export const POST = apiHandler(async (req, c: IdParams) => {
  const id = await idOf(c);
  const body = await readJson(req, changeBody);
  return new BookingService(await bearerCtx(req)).changeBooking(id, body);
});
