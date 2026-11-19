"use client";

import { useEffect, useRef } from "react";
import { cn } from "@smw/ui/utils";
import { dateTime } from "@smw/ui/format";

export interface Bubble { id: string; mine: boolean; senderName: string; body: string; createdAt: string }

/** The messages of one conversation. Opens scrolled to the newest one. */
export function MessageList({ messages, showNames }: { messages: Bubble[]; showNames: boolean }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages.length]);
  return (
    <ul className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1" aria-label="Messages">
      {messages.map((m) => (
        <li key={m.id} className={cn("flex max-w-[85%] flex-col gap-0.5 rounded-2xl px-4 py-2.5", m.mine ? "self-end bg-[var(--ds-color-primary-500)]/20" : "self-start bg-white/[0.06]")}>
          {showNames && !m.mine ? <span className="text-xs font-medium text-[var(--ds-on-surface-variant)]">{m.senderName}</span> : null}
          <p className="whitespace-pre-wrap break-words text-sm text-[var(--ds-on-surface)]">{m.body}</p>
          <time dateTime={m.createdAt} className="self-end text-[11px] text-[var(--ds-on-surface-muted)]">{dateTime(m.createdAt)}</time>
        </li>
      ))}
      <li ref={end} aria-hidden />
    </ul>
  );
}
