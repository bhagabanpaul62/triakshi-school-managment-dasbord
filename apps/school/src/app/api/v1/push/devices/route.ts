import { PreferenceService } from "@smw/feature-notifications/prefs";
import { apiHandler, bearerCtx, readJson } from "@smw/runtime/bearer";
import { deviceBody } from "../../_schemas";

/** GET /api/v1/push/devices: the devices that get my push messages. */
export const GET = apiHandler(async (req) => ({ rows: await new PreferenceService(await bearerCtx(req)).devices() }));

/** POST /api/v1/push/devices { endpoint, p256dh, auth, device? }: register a Web Push subscription (the same one a browser makes). Safe to repeat. */
export const POST = apiHandler(async (req) => {
  const b = await readJson(req, deviceBody);
  await new PreferenceService(await bearerCtx(req)).subscribe(b.endpoint, b.p256dh, b.auth, b.device);
  return { ok: true };
});
