// A person's secret calendar link: /api/calendar/<token>.ics, for Google, Apple and Outlook. No sign-in: the token is the key.
import type { Ctx } from "@smw/feature-kit";
import { feedOwner } from "@smw/feature-events/feed";
import { schoolFromRequest } from "@smw/runtime/bearer";
import { calendarResponse, gone, hostOf, personalCalendar } from "../_lib";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    if (!token.endsWith(".ics")) return gone();
    const school = await schoolFromRequest(req);
    if (!school.features.has("events")) return gone();
    const owner = await feedOwner(school.id, token.slice(0, -4));
    if (!owner) return gone();
    const ctx: Ctx = { schoolId: school.id, userId: owner.userId, role: owner.role, name: owner.name, grants: owner.grants, features: school.features, readOnly: true };
    return calendarResponse(req, await personalCalendar(ctx, hostOf(req), school.name), { cache: "private, max-age=300", filename: "school-calendar.ics" });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", msg: "calendar feed failed", err: String(err) }));
    return gone();
  }
}
