import { NextResponse } from "next/server";
import { AppError } from "@smw/feature-kit";
import { MessageService } from "@smw/feature-messages/service";
import { actionCtx } from "@smw/runtime";

export const dynamic = "force-dynamic";

/**
 * A message file opens only here. The service checks the person is in the conversation (or has a logged review open),
 * then this redirects to a link that works for 60 seconds. Everything else, including another school's file, is "not found".
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { url } = await new MessageService(await actionCtx()).fileLink((await params).id);
    const res = NextResponse.redirect(url, 302);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  } catch (e) {
    if (e instanceof AppError) return new NextResponse("Not found", { status: e.status === 401 ? 401 : 404 });
    throw e;
  }
}
