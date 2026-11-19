import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { shortDate } from "@smw/ui/format";
import { NotificationService } from "../service";
import { markAllNotificationsRead, setEmailDigest } from "./actions";
import { NotificationItem } from "./notification-item";

export const metadata = { title: "Notifications" };

const IST = "Asia/Kolkata";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: IST });
const timeOf = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: IST });

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const svc = new NotificationService(await requireCtx());
  const query = listQueryFrom(await searchParams);
  const unreadOnly = query.filters.unread === "1";
  const [page, digest, { unread }] = await Promise.all([svc.list(query), svc.emailDigestEnabled(), svc.forUser(1)]);

  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const groups: { key: string; label: string; rows: typeof page.rows }[] = [];
  for (const n of page.rows) {
    const key = dayKey(n.createdAt);
    const g = groups.at(-1);
    if (g?.key === key) g.rows.push(n);
    else groups.push({ key, label: key === today ? "Today" : key === yesterday ? "Yesterday" : shortDate(n.createdAt), rows: [n] });
  }

  const tab = (active: boolean) => `inline-flex h-10 items-center rounded-full px-4 text-sm ${active ? "bg-white/[0.1] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)] hover:bg-white/[0.04]"}`;
  const href = (p: number) => `?${new URLSearchParams({ ...(unreadOnly ? { unread: "1" } : {}), page: String(p) })}`;
  const pager = "inline-flex h-10 items-center rounded-full bg-white/[0.06] px-4 hover:bg-white/[0.1]";

  return (
    <>
      <PageHeader eyebrow="Communication" title="Notifications"
        description={unread ? `${unread} unread. Open one to jump to what it is about.` : "You are all caught up."}
        actions={unread ? <ActionButton action={markAllNotificationsRead} label="Mark all read" /> : null} />
      <nav className="mb-4 flex gap-2" aria-label="Filter notifications">
        <Link href="?" className={tab(!unreadOnly)} aria-current={!unreadOnly ? "page" : undefined}>All</Link>
        <Link href="?unread=1" className={tab(unreadOnly)} aria-current={unreadOnly ? "page" : undefined}>Unread{unread ? ` (${unread})` : ""}</Link>
      </nav>
      {groups.length === 0 ? (
        <Panel>
          <p className="py-10 text-center text-sm text-[var(--ds-on-surface-muted)]">
            {unreadOnly ? "Nothing unread. You are all caught up." : "Nothing here yet. Announcements, fee dues and results will show up here."}
          </p>
          {unreadOnly ? <p className="pb-4 text-center"><Link href="?" className="text-sm text-[var(--ds-color-primary-400)] hover:underline">Show all notifications</Link></p> : null}
        </Panel>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <Panel key={g.key} title={g.label} bodyClassName="-mx-2">
              <ul>
                {g.rows.map((n) => (
                  <li key={n.id}><NotificationItem id={n.id} title={n.title} body={n.body} href={n.href} time={timeOf(n.createdAt)} read={!!n.readAt} /></li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
      {page.pageCount > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm text-[var(--ds-on-surface-muted)]" aria-label="Pages">
          {page.page > 1 ? <Link href={href(page.page - 1)} className={pager}>Newer</Link> : <span />}
          <span>Page {page.page} of {page.pageCount}</span>
          {page.page < page.pageCount ? <Link href={href(page.page + 1)} className={pager}>Older</Link> : <span />}
        </nav>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-[var(--ds-surface-container-low)] p-5">
        <div>
          <p className="text-sm text-[var(--ds-on-surface)]">Email digest is {digest ? "on" : "off"}</p>
          <p className="text-xs text-[var(--ds-on-surface-muted)]">{digest ? "We email you a summary of what is still unread." : "You only see notifications here."}</p>
        </div>
        <ActionButton action={setEmailDigest} values={{ enabled: String(!digest) }} label={digest ? "Turn off" : "Turn on"} variant="ghost" successMessage="Preference saved" />
      </div>
    </>
  );
}
