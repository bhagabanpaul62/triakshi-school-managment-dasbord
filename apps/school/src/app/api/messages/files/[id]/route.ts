import { NextResponse } from "next/server";
import { AppError } from "@smw/feature-kit";
import { fileResponse } from "@smw/feature-messages/core";
import { MessageService } from "@smw/feature-messages/service";
import { actionCtx } from "@smw/runtime";

export const dynamic = "force-dynamic";

/**
 * A message file opens only here. The service checks the person is in the conversation (or has a logged review open),
 * then the bytes are sent from here with no-store and the download headers. Everything else, including another school's file, is "not found".
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return fileResponse(await new MessageService(await actionCtx()).file((await params).id));
  } catch (e) {
    if (e instanceof AppError) return new NextResponse("Not found", { status: e.status === 401 ? 401 : 404 });
    throw e;
  }
}
