import { NextResponse } from "next/server";
import { AppError } from "@smw/feature-kit";
import { SafeguardService } from "@smw/feature-messages/safeguard";
import { actionCtx } from "@smw/runtime";

export const dynamic = "force-dynamic";

/** A safeguarding lead's copy of any conversation. The reason is required and goes in the review log. */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const { name, bytes } = await new SafeguardService(await actionCtx()).exportPdf({ threadId: form.get("threadId"), reason: form.get("reason") });
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(e.message, { status: e.status === 422 ? 422 : e.status === 401 ? 401 : e.status === 403 ? 403 : 404 });
    throw e;
  }
}
