import { RsvpService } from "@smw/feature-events/rsvp";
import { apiHandler, bearerCtx, readJson } from "@smw/runtime/bearer";
import { idOf, type IdParams } from "../../../../_lib";
import { rsvpBody } from "../../../../_schemas";

/** POST /api/v1/calendar/events/{id}/rsvp { answer: yes|maybe|no, guests? }: returns { status: going|waiting|maybe|not_going }. */
export const POST = apiHandler(async (req, c: IdParams) => {
  const id = await idOf(c);
  const body = await readJson(req, rsvpBody);
  return { status: await new RsvpService(await bearerCtx(req)).answer(id, body) };
});
