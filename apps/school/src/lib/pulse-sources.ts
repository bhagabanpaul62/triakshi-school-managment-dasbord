// Every number the live pulse and the sidebar tell the page, besides the bell. One function feeds both, so they always agree.
import type { Ctx } from "@smw/feature-kit";
import { FeedService } from "@smw/feature-announcements/feed-service";
import { MessageService } from "@smw/feature-messages/service";
import { RequestService } from "@smw/feature-requests/service";

export type PulseSource = (ctx: Ctx) => Promise<[key: "messages" | "requests", count: number]>;
export type PulseCounts = Record<"messages" | "requests" | "notices", number>;

// A failure here must never break polling or the panel: each source falls back to 0 alone.
export const PULSE_SOURCES: PulseSource[] = [
  async (ctx) => ["messages", ctx.features.has("messages") ? await new MessageService(ctx).unreadCount().catch(() => 0) : 0],
  // Work waiting on me. The office also sees what nobody has taken; a family only ever has its own, so "unassigned" would be its own asks.
  async (ctx) => ["requests", ctx.features.has("requests") ? await new RequestService(ctx).counts().then((c) => c.mine + (ctx.role === "student" ? 0 : c.unassigned)).catch(() => 0) : 0],
];

export async function pulseCounts(ctx: Ctx): Promise<PulseCounts> {
  const counts: PulseCounts = { messages: 0, requests: 0, notices: 0 };
  const [extra, notices] = await Promise.all([
    Promise.all(PULSE_SOURCES.map((s) => s(ctx).catch(() => null))),
    ctx.features.has("announcements") ? new FeedService(ctx).unreadCount().catch(() => 0) : 0,
  ]);
  for (const e of extra) if (e) counts[e[0]] = e[1];
  counts.notices = notices;
  return counts;
}
