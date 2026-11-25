import { z } from "zod";
import { EMAIL_MODES } from "./constants";
import { TOPIC_GROUPS, type TopicKey } from "./topics";

/** What a module hands the writer. */
interface RowBase {
  userId: string;
  title: string;
  body?: string;
  href?: string;
  /** The thing it is about: opening it marks this read, and a correction rewrites it. Required, so no row is left that nothing can close. */
  subject: { type: string; id: string };
  groupKey?: string;
  action?: boolean;
  urgent?: boolean;
  privateBody?: boolean;
  /** Earliest time to push or email it (the app row shows at once). */
  deliverAfter?: Date;
}

export type NotificationRow = RowBase & { topic: TopicKey };

const group = z.enum(Object.keys(TOPIC_GROUPS) as [keyof typeof TOPIC_GROUPS, ...(keyof typeof TOPIC_GROUPS)[]]);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 20:00");

export const groupPrefInput = z.object({ group, push: z.boolean(), email: z.enum(EMAIL_MODES) });
export const quietInput = z.object({ from: hhmm, to: hhmm }).nullable();
export const digestInput = z.union([z.literal(8), z.literal(18)]);
export const languageInput = z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, "Choose a language from the list").nullable();
export const awayInput = z.object({
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date").nullable(),
  text: z.string().trim().max(200, "Keep it under 200 characters").optional(),
});
/** Only the browsers' own push services: an endpoint is a URL the server will call, so it must never point anywhere else. */
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];
export const pushEndpointOk = (u: string) => {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && !url.username && !url.password && PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch { return false; }
};
export const subscribeInput = z.object({
  endpoint: z.url().max(1000).refine(pushEndpointOk, "This is not a browser push address"),
  p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100), device: z.string().trim().max(80).optional(),
});

export const listFilters = z.object({ tab: z.enum(["action", "all"]).default("all"), unread: z.literal("1").optional(), group: group.optional() });
