import { DevCheckout } from "@smw/billing";
import { env, fakePayments } from "@smw/config";
import { AppError } from "@smw/feature-kit";

export const dynamic = "force-dynamic";

/** Marks a fake order paid or failed, runs the same confirm path as the real return URL, then sends the browser back to the school. */
export async function POST(req: Request) {
  if (!fakePayments()) return new Response("Not found", { status: 404 });
  const fd = await req.formData();
  const order = String(fd.get("order") ?? ""), back = String(fd.get("return") ?? "");
  const outcome = fd.get("outcome") === "fail" ? "fail" : "pay";
  let target: URL;
  try { target = new URL(back); } catch { return new Response("Bad return address", { status: 400 }); }
  // Only ever bounce to a school host of this install (no open redirect).
  const root = env().ROOT_DOMAIN;
  if (target.hostname !== root && !target.hostname.endsWith(`.${root}`)) return new Response("Bad return address", { status: 400 });
  try {
    await DevCheckout.settle(order, outcome);
  } catch (err) {
    if (err instanceof AppError) return new Response(err.message, { status: err.status });
    throw err;
  }
  return Response.redirect(target.toString(), 303);
}
