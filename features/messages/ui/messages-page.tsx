import Link from "next/link";
import { IconBellOff, IconPin } from "@tabler/icons-react";
import { NotFoundError, ForbiddenError } from "@smw/feature-kit";
import { CommSettingsService } from "@smw/feature-notifications/settings";
import { NotificationService } from "@smw/feature-notifications/service";
import { LivePulse } from "@smw/feature-notifications/ui/live-pulse";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { SavedViews } from "@smw/ui/comm/SavedViews";
import { PersonLine } from "@smw/ui/comm/PersonLine";
import { FOCUS, PILL_BTN, PRIMARY_BTN } from "./styles";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { relative } from "@smw/ui/format";
import { cn } from "@smw/ui/utils";
import { INPUT } from "@smw/ui/shell/FormModal";
import { isFamily } from "../core";
import { MessageService, type InboxQuery, type InboxThread } from "../service";
import { UnreadFallback } from "./empty";
import { ThreadPane } from "./thread-pane";

export const metadata = { title: "Messages" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const VIEWS = ["all", "unread", "archived"] as const;

function Row({ t, selected, href }: { t: InboxThread; selected: boolean; href: string }) {
  const who = t.people[0]?.name ?? t.subject;
  return (
    <li>
      <Link href={href} aria-current={selected ? "page" : undefined}
        className={cn("flex min-h-16 items-start gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-white/[0.04]", FOCUS, selected && "bg-white/[0.06]")}>
        <PersonLine name={t.people.length > 1 ? t.subject : who} size="sm" className="shrink-0 [&>span:last-child]:hidden" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("truncate text-sm", t.unread ? "font-medium text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-variant)]")}>{t.subject}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-[var(--ds-on-surface-muted)]">
              {t.pinned ? <IconPin className="h-3 w-3" aria-label="Pinned" /> : null}{t.muted ? <IconBellOff className="h-3 w-3" aria-label="Muted" /> : null}
              <span title={t.lastMessageAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}>{relative(t.lastMessageAt)}</span>
            </span>
          </span>
          <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{t.studentName ? `About ${t.studentName} · ` : ""}{t.people.map((p) => p.name).join(", ")}</span>
          <span className="block truncate text-xs text-[var(--ds-on-surface-variant)]">{t.state === "closed" ? "Closed · " : ""}{t.lastSenderName ? `${t.lastSenderName}: ` : ""}{t.preview}</span>
        </span>
        {t.unread ? <ToneBadge label={t.unread} tone="info" /> : null}
      </Link>
    </li>
  );
}

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const ctx = await requireCtx();
  const svc = new MessageService(ctx);
  const sp = await searchParams;
  const thread = one(sp.thread) ?? one(sp.t);
  const view = (VIEWS as readonly string[]).includes(one(sp.view) ?? "") ? (one(sp.view) as InboxQuery["view"]) : "all";
  const query: InboxQuery = { view, q: one(sp.q), studentId: one(sp.student), cursor: one(sp.cursor) };
  const staff = !isFamily(ctx.role);

  // Open the conversation first: that marks it read, so the inbox beside it shows it as read.
  let open = null;
  let missing = false;
  if (thread) {
    try { open = await svc.thread(thread, { before: one(sp.before) }); } catch (e) { if (e instanceof NotFoundError || e instanceof ForbiddenError) missing = true; else throw e; }
  }
  const [inbox, kids, rules, replies, pulse, settings] = await Promise.all([
    svc.inbox(query), staff ? svc.inboxStudents() : Promise.resolve([]), svc.startRules(), open && staff ? svc.savedReplies() : Promise.resolve([]),
    ctx.features.has("notifications") ? new NotificationService(ctx).pulse() : Promise.resolve({ bell: 0 }),
    ctx.features.has("notifications") ? new CommSettingsService(ctx).get() : Promise.resolve(null),
  ]);
  const teachers = open && svc.can("manage") && open.thread.state === "closed" && one(sp.move) ? await svc.teacherChoices() : [];

  const keep: Record<string, string | undefined> = { view: view === "all" ? undefined : view, q: query.q, student: query.studentId };
  const link = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...keep, ...extra })) if (v) p.set(k, v);
    const s = p.toString();
    return `/app/messages${s ? `?${s}` : ""}`;
  };
  const filtered = !!query.q || !!query.studentId || view !== "all";

  return (
    <>
      {ctx.features.has("notifications") ? <LivePulse fast={!!open} bell={pulse.bell} messages={inbox.unread} requests={0} /> : null}
      <PageHeader eyebrow="Communication" title="Messages" description={staff ? "Private conversations with families and colleagues. The school can review a conversation for safety." : "Private conversations with your child's teachers and the school office."}
        actions={<>
          {staff ? <Link href="/app/messages/families" className={PILL_BTN}>Message families</Link> : null}
          {staff ? <Link href="/app/messages/hours" className={PILL_BTN}>My hours</Link> : null}
          {rules.canStart ? <Link href="/app/messages/new" className={PRIMARY_BTN}>New message</Link> : null}
        </>} />
      {rules.why ? <p className="mb-3 rounded-2xl bg-white/[0.04] px-4 py-3 text-sm text-[var(--ds-on-surface-variant)]" role="status">{rules.why}</p> : null}
      <div className="grid gap-3 lg:h-[calc(100dvh-15rem)] lg:min-h-[520px] lg:grid-cols-[380px_minmax(0,1fr)]">
        <Panel className={cn("min-h-0", open || missing ? "hidden lg:flex" : "flex")} bodyClassName="flex min-h-0 flex-1 flex-col gap-3">
          <SavedViews label="Inbox views" basePath="/app/messages" param="view" active={view ?? "all"} params={{ q: query.q, student: query.studentId, thread: thread ?? undefined }}
            views={[{ key: "all", label: "Inbox" }, { key: "unread", label: "Unread", count: inbox.unread }, { key: "archived", label: "Archived" }]} />
          <form action="/app/messages" className="flex flex-col gap-2" role="search">
            {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
            <input type="search" name="q" defaultValue={query.q} placeholder="Search messages" aria-label="Search your messages" enterKeyHint="search" className={cn(INPUT, "w-full")} />
            {kids.length ? (
              <select name="student" defaultValue={query.studentId ?? ""} aria-label="Filter by student" className={cn(INPUT, "w-full")}>
                <option value="">All students</option>
                {kids.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
            ) : null}
            <button type="submit" className="sr-only">Search</button>
          </form>
          <div className="custom-scrollbar -mx-2 min-h-0 flex-1 overflow-y-auto px-1">
            {inbox.rows.length ? (
              <ul className="flex flex-col gap-1" aria-label="Conversations">
                {inbox.rows.map((t) => <Row key={t.id} t={t} selected={t.id === open?.thread.id} href={link({ thread: t.id, cursor: query.cursor ?? undefined })} />)}
              </ul>
            ) : filtered ? (
              <UnreadFallback title="Nothing matches" text={view === "unread" ? "You have read everything." : "No conversation matches these filters."} href="/app/messages" label="Clear filters" />
            ) : (
              <UnreadFallback title="No conversations yet" text={staff ? "Write to a family about one student, or to a colleague." : "Write to your child's teacher or the school office."} href={rules.canStart ? "/app/messages/new" : undefined} label="New message" />
            )}
            <nav className="flex items-center justify-between gap-2 px-2 py-3 text-sm" aria-label="Pages of conversations">
              {query.cursor ? <Link href={link({ thread: thread ?? undefined })} className={PILL_BTN}>Back to newest</Link> : <span />}
              {inbox.next ? <Link href={link({ cursor: inbox.next, thread: thread ?? undefined })} className={PILL_BTN}>Older conversations</Link> : null}
            </nav>
          </div>
        </Panel>

        <Panel className={cn("min-h-[60dvh] lg:min-h-0", open || missing ? "flex" : "hidden lg:flex")} bodyClassName="flex min-h-0 flex-1 flex-col">
          {open ? (
            <ThreadPane
              id={open.thread.id} subject={open.thread.subject} studentName={open.thread.studentName} reviewBanner={open.reviewBanner} firstWrite={open.firstWrite}
              people={open.members.filter((m) => m.state === "active").map((m) => ({ userId: m.userId, name: m.name, role: m.role, mine: m.mine }))}
              messages={open.messages.map((m) => ({
                id: m.id, kind: m.kind, sender: m.sender, mine: m.mine, body: m.body, at: m.at.toISOString(), deliverAfter: m.deliverAfter?.toISOString() ?? null, removed: m.removed, removedByName: m.removedByName,
                files: m.files, seen: m.seen ? { by: m.seen.by, of: m.seen.of, at: m.seen.at?.toISOString() ?? null } : null,
              }))}
              olderHref={open.hasOlder && open.oldestAt ? link({ thread: open.thread.id, before: open.oldestAt }) : null}
              block={open.block} notice={open.notice} canFiles={settings?.attachments ?? true} replies={replies}
              flags={open.flags}
              backHref={link({})} moveTo={teachers} safetyContacts={settings?.safetyContacts ?? []} />
          ) : missing ? (
            <UnreadFallback title="That conversation was not found" text="It may have been removed, or it is not yours to open." href="/app/messages" label="Back to your inbox" />
          ) : (
            <UnreadFallback title="Pick a conversation" text={rules.canStart ? "Or start a new message." : "Your conversations will show here."} href={rules.canStart ? "/app/messages/new" : undefined} label="New message" />
          )}
        </Panel>
      </div>
    </>
  );
}
