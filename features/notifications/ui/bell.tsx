"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { relative } from "@smw/ui/format";
import { useReadMarks, UrgentChip, type ItemData } from "./notification-item";

export interface BellItem extends ItemData { createdAt: string }

/** The bell. The number and the rows come from the server; marking read paints on top until the next server snapshot replaces it. */
export function NotificationBell({ bell, items, listHref = "/app/notifications" }: { bell: number; items: BellItem[]; listHref?: string }) {
  const [open, setOpen] = useState(false);
  const marks = useReadMarks(`${bell}:${items.map((i) => `${i.id}${i.read}${i.count}`).join()}`);
  const unread = marks.all ? 0 : Math.max(0, bell - marks.pending);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} title="Notifications"
        className="relative flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06] text-[var(--ds-on-surface-variant)] transition-colors hover:bg-white/[0.12] hover:text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2-3v-3a7 7 0 0 1 4-6" /><path d="M9 17v1a3 3 0 0 0 6 0v-1" />
        </svg>
        {unread ? <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--ds-color-primary-500)] px-1 text-[10px] font-medium tabular-nums text-white">{unread > 99 ? "99+" : unread}</span> : null}
      </button>
      {open ? (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-3xl bg-[var(--ds-surface-container-low)] p-4 shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-[15px] font-medium text-[var(--ds-on-surface)]">Notifications{unread ? <span className="ml-2 text-xs font-normal text-[var(--ds-on-surface-muted)]">{unread} unread</span> : null}</h3>
            {unread ? <button type="button" onClick={marks.readAll} className="inline-flex h-10 items-center rounded-full px-3 text-xs text-[var(--ds-color-primary-400)] hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Mark all read</button> : null}
          </div>
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--ds-on-surface-muted)]">You are all caught up. New notices and updates will appear here.</p>
          ) : (
            <ul className="custom-scrollbar flex max-h-96 flex-col gap-1 overflow-y-auto">
              {items.map((it) => {
                const read = marks.isRead(it);
                const inner = (
                  <>
                    <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${read ? "bg-transparent" : "bg-[var(--ds-color-primary-500)]"}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`flex items-center gap-2 text-sm ${read ? "text-[var(--ds-on-surface-variant)]" : "text-[var(--ds-on-surface)]"}`}>
                        <span className="min-w-0 truncate">{it.title}</span>{it.urgent ? <UrgentChip /> : null}
                      </span>
                      {it.body ? <span className="line-clamp-2 text-xs text-[var(--ds-on-surface-muted)]">{it.body}</span> : null}
                      <span className="block text-[11px] text-[var(--ds-on-surface-muted)]">{relative(it.createdAt)}{it.count > 1 ? ` · ${it.count} updates` : ""}</span>
                    </span>
                  </>
                );
                const cls = "flex min-h-12 w-full items-start gap-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";
                return (
                  <li key={it.id}>
                    {it.href ? <Link href={it.href} className={cls} onClick={() => { marks.readOne(it); setOpen(false); }}>{inner}</Link>
                      : <button type="button" className={cls} onClick={() => marks.readOne(it)}>{inner}</button>}
                  </li>
                );
              })}
            </ul>
          )}
          <Link href={listHref} onClick={() => setOpen(false)} className="mt-3 flex h-10 items-center justify-center rounded-full bg-white/[0.06] text-sm text-[var(--ds-on-surface-variant)] hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">See all</Link>
        </div>
      ) : null}
    </div>
  );
}
