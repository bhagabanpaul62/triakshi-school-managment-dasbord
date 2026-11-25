import { actionCtx } from "@smw/runtime";
import { EventService } from "@smw/feature-events/service";
import { failure } from "../../_lib";

export const dynamic = "force-dynamic";

/** An event's file: the event is checked first, then the person is sent to a link that works for 60 seconds. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { url } = await new EventService(await actionCtx()).fileLink((await params).id);
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } });
  } catch (err) { return failure(err); }
}
