import { PreferenceService } from "@smw/feature-notifications/prefs";
import { apiHandler, bearerCtx, readJson } from "@smw/runtime/bearer";
import { prefsBody } from "../../_schemas";

/** GET /api/v1/notifications/preferences: what each group does for me now, quiet hours, digest hour, away dates, language. */
export const GET = apiHandler(async (req) => new PreferenceService(await bearerCtx(req)).mine());

/** PUT /api/v1/notifications/preferences { groups?, quiet?, digestHour?, language?, away? }: change only what is sent; returns the new settings. Always-sent groups answer 422. */
export const PUT = apiHandler(async (req) => {
  const b = await readJson(req, prefsBody);
  const svc = new PreferenceService(await bearerCtx(req));
  for (const g of b.groups ?? []) await svc.saveGroup(g);
  if (b.quiet !== undefined) await svc.saveQuiet(b.quiet);
  if (b.digestHour !== undefined) await svc.saveDigest(b.digestHour);
  if (b.language !== undefined) await svc.saveLanguage(b.language);
  if (b.away !== undefined) await svc.setAway(b.away.until, b.away.text);
  return svc.mine();
});
