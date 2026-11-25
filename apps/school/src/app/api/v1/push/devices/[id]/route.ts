import { PreferenceService } from "@smw/feature-notifications/prefs";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { idOf, type IdParams } from "../../../_lib";

/** DELETE /api/v1/push/devices/{id}: stop pushing to one of my devices. 404 for a device that is not mine. */
export const DELETE = apiHandler(async (req, c: IdParams) => {
  const id = await idOf(c);
  await new PreferenceService(await bearerCtx(req)).removeDevice(id);
  return { ok: true };
});
