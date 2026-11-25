"use client";

import { ChatBubble } from "@smw/ui/comm/ChatBubble";
import { ConversationLog } from "@smw/ui/comm/ConversationLog";

export interface BubbleItem {
  id: string; kind: "text" | "system" | "note"; mine: boolean; sender: string; body: string; at: string; removed: boolean;
  files: { id: string; name: string; size: number; type: string }[];
}

/** The conversation of one request. Files open through the request's own checked route. */
export function Conversation({ items, requestId }: { items: BubbleItem[]; requestId: string }) {
  return (
    <ConversationLog className="h-[52dvh] min-h-72" label="Conversation" items={items.map((m) => ({
      id: m.id, at: m.at, mine: m.mine,
      node: <ChatBubble kind={m.kind === "text" ? "message" : m.kind} mine={m.mine} sender={m.sender} at={m.at} text={m.body} removed={m.removed}
        files={m.files.map((f) => ({ id: f.id, name: f.name, sizeBytes: f.size, type: f.type, href: `/api/requests/${requestId}/files/${f.id}` }))} />,
    }))} empty={<p className="py-8 text-center text-sm text-[var(--ds-on-surface-muted)]">Nothing has been written yet.</p>} />
  );
}
