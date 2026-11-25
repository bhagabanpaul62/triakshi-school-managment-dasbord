import { env } from "@smw/config";
import { pushConfigured } from "@smw/integrations";

export const dynamic = "force-dynamic";

/** The public half of the push key, so the browser can subscribe. Nothing here is secret; 404 means push is off. */
export async function GET() {
  return pushConfigured() ? Response.json({ key: env().VAPID_PUBLIC_KEY }) : Response.json({ error: "Push is not set up" }, { status: 404 });
}
