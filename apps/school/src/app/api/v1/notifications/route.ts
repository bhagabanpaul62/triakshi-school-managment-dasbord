import { NotificationService } from "@smw/feature-notifications/service";
import { apiHandler, bearerCtx } from "@smw/runtime/bearer";
import { listQueryOf } from "../_lib";

/** GET /api/v1/notifications?page&pageSize&tab=action|all&unread=1&group: my notifications, newest first, with `unread` for the bell. */
export const GET = apiHandler(async (req) => {
  const svc = new NotificationService(await bearerCtx(req));
  const [page, pulse] = await Promise.all([svc.list(listQueryOf(req)), svc.pulse()]);
  return { ...page, unread: pulse.bell, needsAction: pulse.needsAction };
});
