// Every number the live pulse tells the page about, besides the bell. Add a line to show another badge.
import type { Ctx } from "@smw/feature-kit";
import { MessageService } from "@smw/feature-messages/service";

export type PulseSource = (ctx: Ctx) => Promise<[key: "messages" | "requests", count: number]>;

// A failure here must never break polling, same as the panel layout.
export const PULSE_SOURCES: PulseSource[] = [
  async (ctx) => ["messages", ctx.features.has("messages") ? await new MessageService(ctx).unreadCount().catch(() => 0) : 0],
];
