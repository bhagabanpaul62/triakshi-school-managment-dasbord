// Polled every 60 seconds by the bell: the numbers behind the bell and the sidebar badges, for the signed-in person only.
import { actionCtx } from "@smw/runtime";
import { UnauthenticatedError } from "@smw/feature-kit";
import { NotificationService } from "@smw/feature-notifications/service";
import { PULSE_SOURCES } from "@/lib/pulse-sources";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const ctx = await actionCtx();
    const counts = { messages: 0, requests: 0 };
    const [pulse, extra] = await Promise.all([
      ctx.features.has("notifications") ? new NotificationService(ctx).pulse() : { bell: 0, needsAction: 0 },
      Promise.all(PULSE_SOURCES.map((s) => s(ctx).catch(() => null))),
    ]);
    for (const e of extra) if (e) counts[e[0]] = e[1];
    return Response.json({ bell: pulse.bell, ...counts }, { headers });
  } catch (err) {
    return Response.json({ error: err instanceof UnauthenticatedError ? "signed out" : "unavailable" }, { status: err instanceof UnauthenticatedError ? 401 : 403, headers });
  }
}
