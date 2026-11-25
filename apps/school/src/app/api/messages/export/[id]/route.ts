import { NextResponse } from "next/server";
import { AppError } from "@smw/feature-kit";
import { MessageService } from "@smw/feature-messages/service";
import { actionCtx } from "@smw/runtime";

export const dynamic = "force-dynamic";

/** A person's own PDF copy of a conversation they are in. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { name, bytes } = await new MessageService(await actionCtx()).exportPdf((await params).id);
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(e.status === 403 ? e.message : "Not found", { status: e.status === 401 ? 401 : e.status === 403 ? 403 : 404 });
    throw e;
  }
}
