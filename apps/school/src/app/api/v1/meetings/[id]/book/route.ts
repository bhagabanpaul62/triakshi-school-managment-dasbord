import { BookingService } from "@smw/feature-meetings/service";
import { apiHandler, bearerCtx, readJson } from "@smw/runtime/bearer";
import { idOf, type IdParams } from "../../../_lib";
import { bookBody } from "../../../_schemas";

/** POST /api/v1/meetings/{id}/book { slotId, studentId? }: take a free time. 409 when someone else just took it. */
export const POST = apiHandler(async (req, c: IdParams) => {
  const id = await idOf(c);
  const body = await readJson(req, bookBody);
  return new BookingService(await bearerCtx(req)).book(id, body);
});
