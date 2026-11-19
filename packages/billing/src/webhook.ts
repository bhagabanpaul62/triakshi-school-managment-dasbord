import { eq, webhookEvents, withConsole } from "@smw/db";
import { services } from "@smw/integrations";
import { ensureGateway } from "./gateway";
import { PlatformBilling } from "./platform-billing";

export type WebhookOutcome = { status: "processed" | "ignored" | "duplicate"; eventId: string };

const PAYMENT_EVENTS = new Set(["PAYMENT_SUCCESS_WEBHOOK", "PAYMENT_SUCCESS"]);

/**
 * Gateway webhooks: verify the signature (the gateway adapter throws on a bad one), record the event once
 * (unique provider + event id, so replays are ignored), then run the same confirm path as the return URL.
 */
export class WebhookProcessor {
  async handle(rawBody: string, headers: Record<string, string | undefined>): Promise<WebhookOutcome> {
    ensureGateway();
    const gw = services().payments;
    const event = gw.parseWebhook(rawBody, headers);

    const inserted = await withConsole((tx) => tx.insert(webhookEvents)
      .values({ provider: gw.name, eventId: event.id, type: event.type, payload: event.raw as object })
      .onConflictDoNothing().returning({ id: webhookEvents.id }));
    if (!inserted[0]) return { status: "duplicate", eventId: event.id };

    try {
      let status: WebhookOutcome["status"] = "ignored";
      if (PAYMENT_EVENTS.has(event.type) && event.orderId) {
        await PlatformBilling.system().confirmOrder(event.orderId); // asks the gateway again; the body is never trusted for money
        status = "processed";
      }
      await withConsole((tx) => tx.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, inserted[0]!.id)));
      return { status, eventId: event.id };
    } catch (err) {
      // Forget the event so the gateway's retry is processed instead of dropped as a replay.
      await withConsole((tx) => tx.delete(webhookEvents).where(eq(webhookEvents.id, inserted[0]!.id)));
      throw err;
    }
  }
}
