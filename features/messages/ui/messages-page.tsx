import Link from "next/link";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { initials, relative } from "@smw/ui/format";
import { cn } from "@smw/ui/utils";
import { MessageService, type InboxThread } from "../service";
import { searchContacts, sendMessage, startThread } from "./actions";
import { ComposeModal } from "./compose-modal";
import { Composer } from "./composer";
import { peopleLine } from "./labels";
import { MessageList } from "./message-list";

export const metadata = { title: "Messages" };

const ROW = "flex items-start gap-3 rounded-2xl px-3 py-3 transition-colors duration-150 hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";

function ThreadRow({ t, selected }: { t: InboxThread; selected: boolean }) {
  const who = t.kind === "direct" ? t.people[0]?.name ?? t.subject : t.subject;
  return (
    <li>
      <Link href={`/app/messages?t=${t.id}`} aria-current={selected ? "page" : undefined} className={cn(ROW, selected && "bg-white/[0.06]")}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-[11px]" aria-hidden>{initials(who)}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("truncate text-sm", t.unread ? "font-medium text-[var(--ds-on-surface)]" : "text-[var(--ds-on-surface-variant)]")}>{t.subject}</span>
            <span className="ml-auto shrink-0 text-[11px] text-[var(--ds-on-surface-muted)]">{relative(t.lastMessageAt)}</span>
          </span>
          <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{t.people.map((p) => p.name).join(", ")}</span>
          <span className="block truncate text-xs text-[var(--ds-on-surface-variant)]">{t.lastSenderName ? `${t.lastSenderName}: ` : ""}{t.preview}</span>
        </span>
        {t.unread ? <ToneBadge label={t.unread} tone="info" /> : null}
      </Link>
    </li>
  );
}

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new MessageService(ctx);
  const sp = await searchParams;
  const t = sp.thread ?? sp.t; // notifications link with ?thread=, in-page links with ?t=

  // Open the conversation first: that marks it read, so the inbox below shows it as read.
  let open = null;
  if (typeof t === "string") {
    try { open = await svc.thread(t); } catch (e) { if (!(e instanceof NotFoundError)) throw e; }
  }
  const threads = await svc.inbox();
  const unread = threads.reduce((n, x) => n + x.unread, 0);

  return (
    <>
      <PageHeader eyebrow="Communication" title="Messages" description="Private conversations with the people of your school."
        actions={<ComposeModal search={searchContacts} start={startThread} />} />
      <div className="grid gap-3 lg:h-[calc(100dvh-15rem)] lg:min-h-[480px] lg:grid-cols-[360px_minmax(0,1fr)]">
        <Panel title="Inbox" action={unread ? <ToneBadge label={`${unread} unread`} tone="info" /> : null} className={cn("min-h-0", open ? "hidden lg:flex" : "flex")} bodyClassName="custom-scrollbar -mx-3 overflow-y-auto px-1">
          {threads.length ? (
            <ul className="flex flex-col gap-1" aria-label="Conversations">{threads.map((x) => <ThreadRow key={x.id} t={x} selected={x.id === open?.id} />)}</ul>
          ) : (
            <WidgetEmptyState title="No conversations yet." description="Use New message to start one." />
          )}
        </Panel>

        <Panel title={open?.subject} className={cn("min-h-[60dvh] lg:min-h-0", open ? "flex" : "hidden lg:flex")}
          action={open ? <Link href="/app/messages" className="rounded-full bg-white/[0.06] px-3 py-1.5 text-xs text-[var(--ds-on-surface-variant)] hover:bg-white/[0.12] lg:hidden">Back to inbox</Link> : null}>
          {open ? (
            <>
              <p className="mb-3 truncate text-xs text-[var(--ds-on-surface-muted)]" title={peopleLine(open.people)}>With {peopleLine(open.people)}</p>
              <MessageList showNames={open.kind === "group"}
                messages={open.messages.map((m) => ({ id: m.id, mine: m.senderId === ctx.userId, senderName: m.senderName, body: m.body, createdAt: m.createdAt.toISOString() }))} />
              <Composer threadId={open.id} action={sendMessage} />
            </>
          ) : (
            <WidgetEmptyState title={typeof t === "string" ? "That conversation was not found." : "Pick a conversation."} description="Or start a new message." />
          )}
        </Panel>
      </div>
    </>
  );
}
