"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { IconChevronRight } from "@tabler/icons-react";
import { markNotificationRead } from "./actions";

/** One row of the notifications list. Opening it marks it read at once, then saves. */
export function NotificationItem({ id, title, body, href, time, read: initialRead }: { id: string; title: string; body: string | null; href: string | null; time: string; read: boolean }) {
  const [opened, setRead] = useState(false);
  const read = opened || initialRead;
  const [, start] = useTransition();
  const markRead = () => { if (read) return; setRead(true); start(async () => { await markNotificationRead(id); }); };
  const inner = (
    <>
      <span aria-hidden className={`mt-2 h-2 w-2 shrink-0 rounded-full ${read ? "bg-transparent" : "bg-[var(--ds-color-primary-500)]"}`} />
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${read ? "text-[var(--ds-on-surface-variant)]" : "font-medium text-[var(--ds-on-surface)]"}`}>
          {!read ? <span className="sr-only">Unread: </span> : null}{title}
        </span>
        {body ? <span className="mt-0.5 block text-sm text-[var(--ds-on-surface-muted)]">{body}</span> : null}
      </span>
      <span className="shrink-0 pt-0.5 text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{time}</span>
      {href ? <IconChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden /> : null}
    </>
  );
  const cls = "flex min-h-12 w-full items-start gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";
  return href
    ? <Link href={href} className={cls} onClick={markRead}>{inner}</Link>
    : read ? <div className={cls}>{inner}</div> : <button type="button" className={cls} onClick={markRead} title="Mark as read">{inner}</button>;
}
