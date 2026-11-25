import { NextResponse } from "next/server";
import { InsightsService } from "@smw/feature-website/service";
import { liveOrigin } from "@smw/feature-website/ui/address";
import { actionCtx } from "@smw/runtime";

/** A printable A4 poster with the QR code of the school's website address. */
export async function GET() {
  const ctx = await actionCtx().catch(() => null);
  if (!ctx) return new NextResponse("Sign in first", { status: 401 });
  const svc = new InsightsService(ctx);
  if (!svc.canSee()) return new NextResponse("Not found", { status: 404 });
  const pdf = await svc.poster(await liveOrigin());
  return new NextResponse(Buffer.from(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="school-website-poster.pdf"', "Cache-Control": "private, no-store" } });
}
