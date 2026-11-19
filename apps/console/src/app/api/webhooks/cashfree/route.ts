import { AppError } from "@smw/feature-kit";
import { WebhookProcessor, WebhookSignatureError } from "@smw/billing";

export const dynamic = "force-dynamic";

/** Cashfree calls this after a payment. The body must be read as raw text: the signature covers its exact bytes. */
export async function POST(req: Request) {
  const raw = await req.text();
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { headers[k] = v; });
  try {
    const out = await new WebhookProcessor().handle(raw, headers);
    return Response.json({ ok: true, status: out.status });
  } catch (err) {
    if (err instanceof WebhookSignatureError) return new Response("Invalid signature", { status: 400 });
    if (err instanceof SyntaxError) return new Response("Bad payload", { status: 400 });
    // An unknown order is not worth a gateway retry loop; anything else (database down) is, so it returns 500.
    if (err instanceof AppError && err.status === 404) return Response.json({ ok: true, status: "ignored" });
    console.error(JSON.stringify({ level: "error", msg: "cashfree webhook failed", err: String(err) }));
    return new Response("Error", { status: 500 });
  }
}
