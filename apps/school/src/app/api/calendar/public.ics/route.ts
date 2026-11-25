// The school's public calendar for its website: events for everyone that are marked public, and holidays for the whole school.
import { systemCtx } from "@smw/feature-kit";
import { buildCalendar, eventItem, layerItem } from "@smw/feature-events/ics";
import { EventService } from "@smw/feature-events/service";
import { schoolFromRequest } from "@smw/runtime/bearer";
import { publicHolidays } from "@/lib/calendar-layers";
import { calendarResponse, gone, hostOf } from "../_lib";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const school = await schoolFromRequest(req);
    if (!school.features.has("events")) return gone();
    const host = hostOf(req);
    const [events, holidays] = await Promise.all([
      new EventService(systemCtx(school.id, school.features)).publicEvents(500),
      school.features.has("attendance") ? publicHolidays(school.id, new Date(Date.now() - 30 * 864e5), new Date(Date.now() + 400 * 864e5)) : [],
    ]);
    const body = buildCalendar([...events.map((e) => eventItem(e, host)), ...holidays.map((h) => layerItem(h, host, new Date(h.startsAt)))], { name: school.name });
    return calendarResponse(req, body, { cache: "public, max-age=3600", filename: "school-calendar.ics" });
  } catch {
    return gone();
  }
}
