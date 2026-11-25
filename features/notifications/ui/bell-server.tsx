import { requireCtx } from "@smw/runtime";
import { NotificationService } from "../service";
import { NotificationBell } from "./bell";
import { LivePulse } from "./live-pulse";

/** Server half of the bell: the signed-in user's latest notifications and counts, plus the live refresh. Mount it in the panel top bar; pass the badge counts the layout already has. */
export async function NotificationBellServer({ messages = 0, requests = 0, fast = false }: { messages?: number; requests?: number; fast?: boolean }) {
  const svc = new NotificationService(await requireCtx());
  const { items, unread: bell } = await svc.forUser(8);
  return (
    <>
      <NotificationBell bell={bell} items={items.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, createdAt: n.createdAt.toISOString(), read: !!n.readAt, count: n.count, urgent: n.urgent, todo: n.action && !n.doneAt }))} />
      <LivePulse bell={bell} messages={messages} requests={requests} fast={fast} />
    </>
  );
}
export default NotificationBellServer;
