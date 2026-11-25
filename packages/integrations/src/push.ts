import webpush from "web-push";
import { env } from "@smw/config";

export interface PushSubscriptionRow { endpoint: string; p256dh: string; auth: string }
export interface PushPayload { title: string; body: string; href?: string; tag?: string }
export interface PushOptions { ttl: number; urgency: "very-low" | "low" | "normal" | "high" }

/** "gone" means the device is dead (404/410): the caller deletes the subscription. Any other failure throws. */
export interface PushSender { send(sub: PushSubscriptionRow, payload: PushPayload, opts: PushOptions): Promise<"ok" | "gone"> }

/** Push needs both keys. Without them it is hidden everywhere and nothing else breaks. */
export const pushConfigured = () => !!(env().VAPID_PUBLIC_KEY && env().VAPID_PRIVATE_KEY);

export class WebPushSender implements PushSender {
  async send(sub: PushSubscriptionRow, payload: PushPayload, opts: PushOptions) {
    const e = env();
    if (!e.VAPID_PUBLIC_KEY || !e.VAPID_PRIVATE_KEY) throw new Error("Push is not configured");
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), {
        TTL: opts.ttl, urgency: opts.urgency, timeout: 10_000,
        vapidDetails: { subject: e.VAPID_SUBJECT ?? `mailto:${e.MAIL_FROM.match(/<(.+)>/)?.[1] ?? "no-reply@localhost"}`, publicKey: e.VAPID_PUBLIC_KEY, privateKey: e.VAPID_PRIVATE_KEY },
      });
      return "ok" as const;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return "gone" as const;
      throw err;
    }
  }
}

export class MemoryPushSender implements PushSender {
  readonly sent: { sub: PushSubscriptionRow; payload: PushPayload; opts: PushOptions }[] = [];
  /** Endpoints that answer "gone". */
  readonly gone = new Set<string>();
  /** Endpoints that fail with an error. */
  readonly failing = new Set<string>();
  async send(sub: PushSubscriptionRow, payload: PushPayload, opts: PushOptions) {
    if (this.gone.has(sub.endpoint)) return "gone" as const;
    if (this.failing.has(sub.endpoint)) throw new Error("push service unavailable");
    this.sent.push({ sub, payload, opts });
    return "ok" as const;
  }
}
