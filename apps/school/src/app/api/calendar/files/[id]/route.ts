import { actionCtx } from "@smw/runtime";
import { EventService } from "@smw/feature-events/service";
import { failure } from "../../_lib";

export const dynamic = "force-dynamic";

/** An event's file: the event is checked first, then the bytes go out with the type they were checked as and a disposition that never lets a browser run them. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const f = await new EventService(await actionCtx()).fileContent((await params).id);
    return new Response(Buffer.from(f.bytes), { headers: { "Content-Type": f.type, "Content-Disposition": f.disposition, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
  } catch (err) { return failure(err); }
}
