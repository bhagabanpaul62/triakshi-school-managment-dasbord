"use client";

import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { shortDate } from "../../lib/format";
import { PILL_BTN } from "../finance/ui";

export interface LogItem {
  id: string;
  /** ISO time, for the day separators. */
  at: string;
  /** True when the signed-in person wrote it: the log then always jumps to it. */
  mine?: boolean;
  /** Usually a ChatBubble. */
  node: ReactNode;
}

export interface ConversationLogProps {
  /** Oldest first. */
  items: LogItem[];
  /** Slot at the top: a "Load older messages" button or link. */
  loadOlder?: ReactNode;
  /** Shown when there are no messages yet. */
  empty?: ReactNode;
  label?: string;
  /** Give it a height from the parent, for example "h-[60dvh]". */
  className?: string;
}

const IST = "Asia/Kolkata";
const dayKey = (at: string) => new Date(at).toLocaleDateString("en-CA", { timeZone: IST });
const dayLabel = (at: string) => {
  const k = dayKey(at), now = Date.now();
  return k === dayKey(new Date(now).toISOString()) ? "Today" : k === dayKey(new Date(now - 864e5).toISOString()) ? "Yesterday" : shortDate(at);
};

/** A message list that never yanks the reader: it follows new messages only when already at the bottom, and says "3 new messages" otherwise. */
export function ConversationLog({ items, loadOlder, empty, label = "Conversation", className }: ConversationLogProps) {
  const box = useRef<HTMLDivElement>(null);
  const near = useRef(true);
  const prev = useRef<{ first?: string; last?: string; height: number; n: number }>({ height: 0, n: 0 });
  const [fresh, setFresh] = useState(0);

  const toBottom = () => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; setFresh(0); near.current = true; };

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const p = prev.current;
    const first = items[0]?.id, last = items.at(-1)?.id;
    if (p.n === 0) toBottom();
    else if (first !== p.first && last === p.last) el.scrollTop += el.scrollHeight - p.height; // older messages came in on top: keep the reader's place
    else if (last !== p.last) {
      const at = items.findIndex((i) => i.id === p.last);
      const added = at < 0 ? 0 : items.length - 1 - at;
      if (near.current || items.at(-1)?.mine) toBottom(); else if (added > 0) setFresh((n) => n + added);
    }
    prev.current = { first, last, height: el.scrollHeight, n: items.length };
  }, [items]);

  return (
    <div className={cn("relative flex min-h-0 flex-col", className)}>
      <div ref={box} role="log" aria-live="polite" aria-relevant="additions" aria-label={label} tabIndex={0}
        onScroll={(e) => { const el = e.currentTarget; near.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; if (near.current) setFresh(0); }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]">
        {loadOlder ? <div className="flex justify-center">{loadOlder}</div> : null}
        {items.length === 0 ? empty ?? <p className="py-8 text-center text-sm text-[var(--ds-on-surface-muted)]">No messages yet.</p> : null}
        {items.map((it, n) => {
          const newDay = n === 0 || dayKey(it.at) !== dayKey(items[n - 1]!.at);
          return (
            <Fragment key={it.id}>
              {newDay ? <p className="py-1 text-center font-mono text-[11px] uppercase tracking-[0.05em] text-[var(--ds-on-surface-muted)]">{dayLabel(it.at)}</p> : null}
              {it.node}
            </Fragment>
          );
        })}
      </div>
      {fresh > 0 ? (
        <button type="button" onClick={toBottom} className={cn(PILL_BTN, "absolute bottom-3 left-1/2 -translate-x-1/2 bg-[var(--ds-surface-container-highest)] shadow-lg")}>
          {fresh} new {fresh === 1 ? "message" : "messages"}
        </button>
      ) : null}
    </div>
  );
}
