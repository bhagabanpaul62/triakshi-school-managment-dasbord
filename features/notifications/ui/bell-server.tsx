import { requireCtx } from "@smw/runtime";
import { NotificationService } from "../service";
import { NotificationBell } from "./bell";

/** Server half of the bell: loads the signed-in user's latest notifications. Mount it in the panel top bar. */
export async function NotificationBellServer() {
  const { items, unread } = await new NotificationService(await requireCtx()).forUser(8);
  return <NotificationBell unread={unread} items={items.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, createdAt: n.createdAt.toISOString(), read: !!n.readAt }))} />;
}
export default NotificationBellServer;
