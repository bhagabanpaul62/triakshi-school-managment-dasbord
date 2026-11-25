"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconAlertTriangle, IconChevronRight } from "@tabler/icons-react";
import { toast } from "@smw/ui/shell/toast";
import { markAllNotificationsRead, markNotificationRead } from "./actions";

export interface ItemData {
  id: string; title: string; body: string | null; href: string | null; read: boolean;
  /** Grouped rows: how many things it stands for. */
  count: number; urgent: boolean; /** Still to do (needs action, not done). */ todo: boolean;
}

/**
 * Read marks painted at once on top of what the server sent. The overlay belongs to one server snapshot (`sig`):
 * when new props arrive it is gone, so the screen always ends up equal to the server. A failed save snaps back.
 */
export function useReadMarks(sig: string) {
  const router = useRouter();
  const [, start] = useTransition();
  const [ov, setOv] = useState({ sig, all: false, ids: [] as string[] });
  const cur = ov.sig === sig ? ov : { sig, all: false, ids: [] as string[] };
  const run = (paint: () => void, save: () => Promise<{ ok: boolean; error?: string }>) => {
    paint();
    start(async () => {
      const r = await save();
      if (r.ok) router.refresh();
      else { setOv({ sig, all: false, ids: [] }); toast(r.error ?? "Could not save. Try again.", "danger"); }
    });
  };
  return {
    isRead: (it: { id: string; read: boolean }) => it.read || cur.all || cur.ids.includes(it.id),
    /** Unread among what is shown, after the overlay. */
    readOne: (it: { id: string; read: boolean }) => { if (!it.read && !cur.all && !cur.ids.includes(it.id)) run(() => setOv({ ...cur, ids: [...cur.ids, it.id] }), () => markNotificationRead(it.id)); },
    readAll: () => run(() => setOv({ ...cur, all: true }), () => markAllNotificationsRead()),
    pending: cur.ids.length,
    all: cur.all,
  };
}

export const UrgentChip = () => (
  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--ds-color-danger-500)_14%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[var(--ds-color-danger-400)]">
    <IconAlertTriangle className="h-3 w-3" aria-hidden />Urgent
  </span>
);
const Chip = ({ children }: { children: React.ReactNode }) => <span className="inline-flex shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-[var(--ds-on-surface-variant)]">{children}</span>;

/** One row of the notifications list. Opening it marks it read at once, then saves. */
export function NotificationItem({ item, time, read, onOpen }: { item: ItemData; time: string; read: boolean; onOpen: () => void }) {
  const inner = (
    <>
      <span aria-hidden className={`mt-2 h-2 w-2 shrink-0 rounded-full ${read ? "bg-transparent" : "bg-[var(--ds-color-primary-500)]"}`} />
      <span className="min-w-0 flex-1">
        <span className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ${read ? "text-[var(--ds-on-surface-variant)]" : "font-medium text-[var(--ds-on-surface)]"}`}>
          {!read ? <span className="sr-only">Unread: </span> : null}{item.title}
          {item.urgent ? <UrgentChip /> : null}
          {item.todo ? <Chip>To do</Chip> : null}
          {item.count > 1 ? <Chip>{item.count} updates</Chip> : null}
        </span>
        {item.body ? <span className="mt-0.5 block text-sm text-[var(--ds-on-surface-muted)]">{item.body}</span> : null}
      </span>
      <span className="shrink-0 pt-0.5 text-xs tabular-nums text-[var(--ds-on-surface-muted)]">{time}</span>
      {item.href ? <IconChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden /> : null}
    </>
  );
  const cls = "flex min-h-12 w-full items-start gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-white/[0.04] focus-visible:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]";
  return item.href
    ? <Link href={item.href} className={cls} onClick={onOpen}>{inner}</Link>
    : read ? <div className={cls}>{inner}</div> : <button type="button" className={cls} onClick={onOpen} title="Mark as read">{inner}</button>;
}

export interface Day { key: string; label: string; rows: (ItemData & { time: string })[] }

/** The list grouped by day, with Mark all read repainting every row at once. */
export function NotificationDays({ days, unread }: { days: Day[]; unread: number }) {
  const sig = days.flatMap((d) => d.rows.map((r) => `${r.id}${r.read}${r.count}`)).join() + unread;
  const marks = useReadMarks(sig);
  const left = marks.all ? 0 : Math.max(0, unread - marks.pending);
  return (
    <>
      <div className="mb-3 flex min-h-10 items-center justify-between gap-3">
        <p className="text-sm text-[var(--ds-on-surface-muted)]" role="status">{left ? `${left} unread` : "You are all caught up."}</p>
        {left ? <button type="button" onClick={marks.readAll} className="inline-flex h-10 items-center rounded-full bg-white/[0.06] px-4 text-sm text-[var(--ds-on-surface)] hover:bg-white/[0.1] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Mark all read</button> : null}
      </div>
      <div className="flex flex-col gap-3">
        {days.map((d) => (
          <section key={d.key} className="rounded-3xl bg-[var(--ds-surface-container-low)] p-4">
            <h2 className="mb-2 px-2 text-[15px] font-medium text-[var(--ds-on-surface)]">{d.label}</h2>
            <ul>{d.rows.map((r) => <li key={r.id}><NotificationItem item={r} time={r.time} read={marks.isRead(r)} onOpen={() => marks.readOne(r)} /></li>)}</ul>
          </section>
        ))}
      </div>
    </>
  );
}
