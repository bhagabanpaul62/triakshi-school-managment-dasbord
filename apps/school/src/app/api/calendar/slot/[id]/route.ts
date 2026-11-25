// "Add to calendar" for one booked meeting time. Signed in; only the child's family, the teacher, or a manager.
import { actionCtx } from "@smw/runtime";
import { buildCalendar } from "@smw/feature-events/ics";
import { BookingService } from "@smw/feature-meetings/service";
import { calendarResponse, failure, hostOf } from "../../_lib";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const slotId = (await params).id.replace(/\.ics$/, "");
    const s = await new BookingService(await actionCtx()).slotForCalendar(slotId);
    const host = hostOf(req);
    const item = {
      uid: `meeting-slot-${s.id}@${host}`, title: `Meeting with ${s.teacher}: ${s.title}`, description: `For ${s.student}`, location: s.place,
      url: null, startsAt: s.startsAt, endsAt: s.endsAt, allDay: false, stamp: s.startsAt,
    };
    return calendarResponse(req, buildCalendar([item], { name: s.title }), { cache: "private, no-cache", filename: "meeting.ics", attachment: true });
  } catch (err) { return failure(err); }
}
