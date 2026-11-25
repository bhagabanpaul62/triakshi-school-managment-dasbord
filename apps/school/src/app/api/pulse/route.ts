// Polled every 60 seconds by the bell: the numbers behind the bell and the sidebar badges, for the signed-in person only.
import { actionCtx } from "@smw/runtime";
import { UnauthenticatedError } from "@smw/feature-kit";
import { NotificationService } from "@smw/feature-notifications/service";
import { notificationStamp, pulseCounts } from "@/lib/pulse-sources";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const ctx = await actionCtx();
    const [pulse, counts, stamp] = await Promise.all([
      ctx.features.has("notifications") ? new NotificationService(ctx).pulse() : { bell: 0, needsAction: 0 },
      pulseCounts(ctx), notificationStamp(ctx),
    ]);
    return Response.json({ bell: pulse.bell, ...counts, stamp }, { headers });
  } catch (err) {
    if (err instanceof UnauthenticatedError) return Response.json({ error: "signed out" }, { status: 401, headers });
    console.error(JSON.stringify({ level: "error", msg: "pulse failed", err: String(err) }));
    return Response.json({ error: "unavailable" }, { status: 500, headers });
  }
}
