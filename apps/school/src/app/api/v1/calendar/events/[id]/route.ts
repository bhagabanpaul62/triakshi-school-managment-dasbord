import { EventService } from "@smw/feature-events/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { idOf, type IdParams } from "../../../_lib";

/** GET /api/v1/calendar/events/{id}: one event with its files and my own answer. 404 for an event not meant for this person. */
export const GET = apiHandler(async (req, c: IdParams) => {
  const id = await idOf(c);
  const { event: e, files, owner, me, counts } = await new EventService(await bearerCtx(req)).detail(id);
  return {
    id: e.id, type: e.type, state: e.state, title: e.title, description: e.description, startsAt: e.startsAt, endsAt: e.endsAt, allDay: e.allDay,
    location: e.location, mapUrl: e.mapUrl, bring: e.bring, audience: e.audienceLabel, owner, cancelReason: e.cancelReason, rsvp: e.rsvp, consentHref: e.consentHref,
    files: files.map((x) => ({ id: x.id, name: x.fileName, size: x.size })),
    me: me && { answer: me.answer, guests: me.guests, waiting: !!me.waitingSince, answeredAt: me.answeredAt },
    counts,
  };
});
