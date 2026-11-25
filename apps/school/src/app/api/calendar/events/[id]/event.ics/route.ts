// "Add to calendar" for one event. Signed in; only an event the person may see.
import { actionCtx } from "@smw/runtime";
import { NotFoundError } from "@smw/feature-kit";
import { buildCalendar, eventItem } from "@smw/feature-events/ics";
import { EventService } from "@smw/feature-events/service";
import { calendarResponse, failure, hostOf } from "../../../_lib";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const e = await new EventService(await actionCtx()).get((await params).id);
    if (e.state === "draft") throw new NotFoundError("Event");
    return calendarResponse(req, buildCalendar([eventItem(e, hostOf(req))], { name: e.title }), { cache: "private, no-cache", filename: "event.ics", attachment: true });
  } catch (err) { return failure(err); }
}
