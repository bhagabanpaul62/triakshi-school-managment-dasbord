import { actionCtx } from "@smw/runtime";
import { RsvpService } from "@smw/feature-events/rsvp";
import { failure } from "../../../_lib";

export const dynamic = "force-dynamic";

/** Who answered what, for the person who runs the event. A BOM makes Excel read Hindi names correctly. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { name, text } = await new RsvpService(await actionCtx()).csv((await params).id);
    return new Response(`﻿${text}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" } });
  } catch (err) { return failure(err); }
}
