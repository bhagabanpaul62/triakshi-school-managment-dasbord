import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
// shortcut: relative import until @smw/integrations/index.ts re-exports ./cashfree.
import { CashfreePaymentGateway, WebhookSignatureError } from "@smw/integrations";

const SECRET = "test_secret_key";
const body = JSON.stringify({
  type: "PAYMENT_SUCCESS_WEBHOOK", event_time: "2026-05-01T10:00:00+05:30",
  data: { order: { order_id: "trk_abc", order_amount: 11800 }, payment: { cf_payment_id: 9988776655, payment_amount: 11800, payment_status: "SUCCESS" } },
});
const ts = "1777613400000";
const sig = createHmac("sha256", SECRET).update(ts + body).digest("base64"); // the vector, computed independently of the adapter
const gw = new CashfreePaymentGateway({ appId: "app", secretKey: SECRET });

describe("Cashfree webhook signature", () => {
  it("accepts a valid signature and maps the event", () => {
    const e = gw.parseWebhook(body, { "x-webhook-signature": sig, "x-webhook-timestamp": ts });
    expect(e).toMatchObject({ type: "PAYMENT_SUCCESS_WEBHOOK", orderId: "trk_abc", paymentId: "9988776655", amountPaise: 1_180_000, status: "SUCCESS" });
    expect(e.id).toMatch(/^[0-9a-f]{64}$/);
  });
  it("gives the same event id on a replay with a new timestamp", () => {
    const ts2 = "1777613999999";
    const sig2 = createHmac("sha256", SECRET).update(ts2 + body).digest("base64");
    const a = gw.parseWebhook(body, { "x-webhook-signature": sig, "x-webhook-timestamp": ts });
    const b = gw.parseWebhook(body, { "X-Webhook-Signature": sig2, "X-Webhook-Timestamp": ts2 });
    expect(b.id).toBe(a.id);
  });
  it("rejects a tampered body", () => {
    expect(() => gw.parseWebhook(body.replace("11800", "1"), { "x-webhook-signature": sig, "x-webhook-timestamp": ts })).toThrow(WebhookSignatureError);
  });
  it("rejects a wrong timestamp", () => {
    expect(() => gw.parseWebhook(body, { "x-webhook-signature": sig, "x-webhook-timestamp": "1777613400001" })).toThrow(WebhookSignatureError);
  });
  it("rejects a signature made with another secret, a short signature and missing headers", () => {
    const other = createHmac("sha256", "other").update(ts + body).digest("base64");
    expect(() => gw.parseWebhook(body, { "x-webhook-signature": other, "x-webhook-timestamp": ts })).toThrow(WebhookSignatureError);
    expect(() => gw.parseWebhook(body, { "x-webhook-signature": "abc", "x-webhook-timestamp": ts })).toThrow(WebhookSignatureError);
    expect(() => gw.parseWebhook(body, {})).toThrow(WebhookSignatureError);
  });
});

describe("Cashfree orders (fetch mocked)", () => {
  it("createOrder sends rupees and our checkout page URL", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ order_id: "o1", payment_session_id: "sess_1" }), { status: 200 }));
    const g = new CashfreePaymentGateway({ appId: "app", secretKey: SECRET, mode: "sandbox", fetch: fetchMock as unknown as typeof fetch });
    const r = await g.createOrder({ orderId: "o1", amountPaise: 1_180_050, customer: { id: "c1", name: "A", email: "a@b.in", phone: "9876543210" }, returnUrl: "http://greenfield.localhost:4100/app/billing/return?order_id=o1", notifyUrl: "http://x/hook" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sandbox.cashfree.com/pg/orders");
    expect(JSON.parse(String(init.body))).toMatchObject({ order_id: "o1", order_amount: 11800.5, order_currency: "INR", order_meta: { notify_url: "http://x/hook" } });
    expect((init.headers as Record<string, string>)["x-api-version"]).toBe("2025-01-01");
    expect(r.checkoutUrl).toBe("http://greenfield.localhost:4100/app/billing/checkout?session=sess_1&mode=sandbox&kind=order");
  });
  it("getOrderStatus reads the paid payment id", async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/payments")
      ? [{ payment_status: "FAILED", cf_payment_id: 1 }, { payment_status: "SUCCESS", cf_payment_id: 2 }]
      : { order_status: "PAID", order_amount: 11800 }), { status: 200 }));
    const g = new CashfreePaymentGateway({ appId: "app", secretKey: SECRET, fetch: fetchMock as unknown as typeof fetch });
    expect(await g.getOrderStatus("o1")).toEqual({ status: "PAID", paymentId: "2", amountPaise: 1_180_000 });
  });
  it("surfaces gateway errors without leaking the secret", async () => {
    const g = new CashfreePaymentGateway({ appId: "app", secretKey: SECRET, fetch: (async () => new Response(JSON.stringify({ message: "bad order" }), { status: 400 })) as unknown as typeof fetch });
    await expect(g.getOrderStatus("o1")).rejects.toThrow(/400.*bad order/);
  });
});
