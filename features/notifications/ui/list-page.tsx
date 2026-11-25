import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { shortDate } from "@smw/ui/format";
import { NotificationService } from "../service";
import { TOPIC_GROUPS, TOPICS, type TopicGroup } from "../topics";
import { NotificationDays, type Day } from "./notification-item";

export const metadata = { title: "Notifications" };

const IST = "Asia/Kolkata";
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: IST });
const timeOf = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: IST });
const pill = (active: boolean) => `inline-flex h-10 items-center rounded-full px-4 text-sm ${active ? "bg-white/[0.1] text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-muted)] hover:bg-white/[0.04]"}`;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const svc = new NotificationService(await requireCtx());
  const sp = await searchParams;
  const pulse = await svc.pulse();
  const tab = sp.tab === "action" || sp.tab === "all" ? sp.tab : pulse.needsAction ? "action" : "all";
  const query = listQueryFrom({ ...sp, tab });
  const group = query.filters.group as TopicGroup | undefined;
  const unreadOnly = query.filters.unread === "1";
  const page = await svc.list(query);

  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  const days: Day[] = [];
  for (const n of page.rows) {
    const key = dayKey(n.createdAt);
    const row = { id: n.id, title: n.title, body: n.body, href: n.href, read: !!n.readAt, count: n.count, urgent: n.urgent, todo: n.action && !n.doneAt, time: timeOf(n.createdAt) };
    if (days.at(-1)?.key === key) days.at(-1)!.rows.push(row);
    else days.push({ key, label: key === today ? "Today" : key === yesterday ? "Yesterday" : shortDate(n.createdAt), rows: [row] });
  }

  const href = (o: { tab?: string; group?: string; unread?: boolean; page?: number }) => {
    const p = new URLSearchParams({ tab: o.tab ?? tab, ...(o.group ? { group: o.group } : {}), ...(o.unread ? { unread: "1" } : {}), ...(o.page && o.page > 1 ? { page: String(o.page) } : {}) });
    return `?${p}`;
  };
  const filtered = !!group || unreadOnly;
  const pager = "inline-flex h-10 items-center rounded-full bg-white/[0.06] px-4 hover:bg-white/[0.1]";
  // Only groups that have a topic the person can receive are worth a chip.
  const groups = (Object.keys(TOPIC_GROUPS) as TopicGroup[]).filter((g) => Object.values(TOPICS).some((t) => t.group === g));

  return (
    <>
      <PageHeader eyebrow="Communication" title="Notifications"
        description={pulse.needsAction ? `${pulse.needsAction} waiting for you. ${pulse.bell} unread.` : pulse.bell ? `${pulse.bell} unread. Open one to jump to what it is about.` : "You are all caught up."} />
      <nav className="mb-3 flex flex-wrap gap-2" aria-label="Notification lists">
        <Link href={href({ tab: "action" })} className={pill(tab === "action")} aria-current={tab === "action" ? "page" : undefined}>Needs action{pulse.needsAction ? ` (${pulse.needsAction})` : ""}</Link>
        <Link href={href({ tab: "all" })} className={pill(tab === "all")} aria-current={tab === "all" ? "page" : undefined}>Everything</Link>
      </nav>
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Filter by type">
        <Link href={href({ unread: !unreadOnly, group })} className={pill(unreadOnly)} aria-pressed={unreadOnly}>Unread only</Link>
        <Link href={href({ unread: unreadOnly })} className={pill(!group)}>All types</Link>
        {groups.map((g) => <Link key={g} href={href({ group: g, unread: unreadOnly })} className={pill(group === g)} aria-current={group === g ? "true" : undefined}>{TOPIC_GROUPS[g]}</Link>)}
      </nav>
      {days.length === 0 ? (
        <Panel>
          <p className="py-10 text-center text-sm text-[var(--ds-on-surface-muted)]">
            {filtered ? "Nothing matches these filters."
              : tab === "action" ? "Nothing is waiting for you. Approvals and requests that need you will show here."
              : "Nothing here yet. Notices, fee dues and results will show up here."}
          </p>
          <p className="pb-4 text-center">
            {filtered ? <Link href={href({})} className="text-sm text-[var(--ds-color-primary-400)] hover:underline">Clear filters</Link>
              : tab === "action" ? <Link href={href({ tab: "all" })} className="text-sm text-[var(--ds-color-primary-400)] hover:underline">See everything</Link> : null}
          </p>
        </Panel>
      ) : <NotificationDays days={days} unread={pulse.bell} />}
      {page.pageCount > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-sm text-[var(--ds-on-surface-muted)]" aria-label="Pages">
          {page.page > 1 ? <Link href={href({ group, unread: unreadOnly, page: page.page - 1 })} className={pager}>Newer</Link> : <span />}
          <span>Page {page.page} of {page.pageCount}</span>
          {page.page < page.pageCount ? <Link href={href({ group, unread: unreadOnly, page: page.page + 1 })} className={pager}>Older</Link> : <span />}
        </nav>
      ) : null}
      <p className="mt-8 text-sm text-[var(--ds-on-surface-muted)]"><Link href="/app/notifications/preferences" className="text-[var(--ds-color-primary-400)] hover:underline">Choose what reaches your phone and email</Link></p>
    </>
  );
}
