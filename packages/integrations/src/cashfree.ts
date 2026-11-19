import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@smw/config";
import {
  registerPaymentGateway,
  type CheckoutOrder, type CreatedOrder, type CreatedSubscription, type OrderStatus, type PaymentGateway, type SubscriptionRequest, type WebhookEvent,
} from "./index";

export class WebhookSignatureError extends Error {
  constructor(message = "Invalid webhook signature") { super(message); this.name = "WebhookSignatureError"; }
}

export interface CashfreeOptions {
  appId: string;
  secretKey: string;
  mode?: "sandbox" | "production";
  /** Injected in tests. */
  fetch?: typeof fetch;
}

const BASE = { sandbox: "https://sandbox.cashfree.com/pg", production: "https://api.cashfree.com/pg" } as const;
const API_VERSION = "2025-01-01";

const rupees = (paise: number) => Number((paise / 100).toFixed(2));
const paise = (r: number) => Math.round(Number(r) * 100);

/**
 * Cashfree Payment Gateway over plain `fetch`.
 * Orders, order status and webhooks follow the PG Orders API (2025-01-01).
 * Subscriptions are written from the documented PG Subscriptions endpoints but NOT tested against Cashfree:
 * verify against the Cashfree docs and sandbox before going live.
 */
export class CashfreePaymentGateway implements PaymentGateway {
  readonly name = "cashfree" as const;
  private readonly mode: "sandbox" | "production";
  private readonly http: typeof fetch;

  constructor(private readonly opts: CashfreeOptions) {
    this.mode = opts.mode ?? "sandbox";
    this.http = opts.fetch ?? fetch;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await this.http(`${BASE[this.mode]}${path}`, {
      method,
      headers: { "x-client-id": this.opts.appId, "x-client-secret": this.opts.secretKey, "x-api-version": API_VERSION, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
    if (!res.ok) {
      const msg = (json as { message?: string } | null)?.message ?? text.slice(0, 200);
      throw new Error(`Cashfree ${method} ${path} failed (${res.status}): ${msg}`);
    }
    return json as T;
  }

  /** The hosted checkout needs Cashfree's JS SDK, so we hand back our own page (on the school's host) that loads it. */
  private checkoutPage(returnUrl: string, session: string, kind: "order" | "subscription" = "order") {
    const origin = new URL(returnUrl).origin;
    return `${origin}/app/billing/checkout?session=${encodeURIComponent(session)}&mode=${this.mode}&kind=${kind}`;
  }

  async createOrder(o: CheckoutOrder): Promise<CreatedOrder> {
    const r = await this.call<{ order_id: string; payment_session_id: string }>("POST", "/orders", {
      order_id: o.orderId,
      order_amount: rupees(o.amountPaise),
      order_currency: "INR",
      customer_details: { customer_id: o.customer.id, customer_name: o.customer.name, customer_email: o.customer.email, customer_phone: o.customer.phone },
      order_meta: { return_url: o.returnUrl, notify_url: o.notifyUrl },
      order_note: o.note,
    });
    return { orderId: r.order_id, paymentSessionId: r.payment_session_id, checkoutUrl: this.checkoutPage(o.returnUrl, r.payment_session_id) };
  }

  async getOrderStatus(orderId: string) {
    const id = encodeURIComponent(orderId);
    const order = await this.call<{ order_status: string; order_amount: number }>("GET", `/orders/${id}`);
    const status: OrderStatus = (["PAID", "EXPIRED", "TERMINATED"] as const).find((s) => s === order.order_status) ?? "ACTIVE";
    let paymentId: string | undefined;
    if (status === "PAID") {
      const pays = await this.call<{ payment_status: string; cf_payment_id: string | number }[]>("GET", `/orders/${id}/payments`);
      const ok = pays.find((p) => p.payment_status === "SUCCESS");
      paymentId = ok ? String(ok.cf_payment_id) : undefined;
    }
    return { status, paymentId, amountPaise: paise(order.order_amount) };
  }

  // verify against Cashfree docs before going live: endpoint paths, plan_details fields and the SDK call for subscriptions are unconfirmed.
  async createSubscription(s: SubscriptionRequest): Promise<CreatedSubscription> {
    const amount = rupees(s.amountPaise);
    const r = await this.call<{ subscription_id: string; subscription_session_id: string }>("POST", "/subscriptions", {
      subscription_id: s.subscriptionId,
      customer_details: { customer_name: s.customer.name, customer_email: s.customer.email, customer_phone: s.customer.phone },
      plan_details: {
        plan_name: s.planName, plan_type: "PERIODIC", plan_currency: "INR",
        plan_recurring_amount: amount, plan_max_amount: amount, plan_max_cycles: 120,
        plan_intervals: s.intervalMonths, plan_interval_type: "MONTH",
      },
      authorization_details: { authorization_amount: 1, authorization_amount_refund: true },
      subscription_meta: { return_url: s.returnUrl, notify_url: s.notifyUrl },
    });
    return { subscriptionId: r.subscription_id, checkoutUrl: this.checkoutPage(s.returnUrl, r.subscription_session_id, "subscription") };
  }

  // verify against Cashfree docs before going live.
  async cancelSubscription(subscriptionId: string) {
    await this.call("POST", `/subscriptions/${encodeURIComponent(subscriptionId)}/manage`, { subscription_id: subscriptionId, action: "CANCEL" });
  }

  /** Signature = base64(HMAC_SHA256(secretKey, timestamp + rawBody)). Throws on any mismatch. */
  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookEvent {
    const h: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
    const signature = h["x-webhook-signature"], timestamp = h["x-webhook-timestamp"];
    if (!signature || !timestamp) throw new WebhookSignatureError("Missing webhook signature headers");
    const expected = Buffer.from(CashfreePaymentGateway.sign(this.opts.secretKey, timestamp, rawBody));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new WebhookSignatureError();

    const body = JSON.parse(rawBody) as {
      type?: string;
      event_time?: string;
      data?: {
        order?: { order_id?: string; order_amount?: number };
        payment?: { cf_payment_id?: string | number; payment_amount?: number; payment_status?: string };
        subscription?: { subscription_id?: string; subscription_status?: string };
        cf_payment_id?: string | number;
        payment_amount?: number;
      };
    };
    const d = body.data ?? {};
    const type = body.type ?? "UNKNOWN";
    const orderId = d.order?.order_id;
    const subscriptionId = d.subscription?.subscription_id;
    const paymentId = d.payment?.cf_payment_id ?? d.cf_payment_id;
    const amount = d.payment?.payment_amount ?? d.payment_amount ?? d.order?.order_amount;
    const id = createHash("sha256").update([type, orderId ?? "", subscriptionId ?? "", paymentId ?? ""].join("|")).digest("hex");
    return {
      id, type, orderId, subscriptionId,
      paymentId: paymentId == null ? undefined : String(paymentId),
      amountPaise: amount == null ? undefined : paise(amount),
      status: d.payment?.payment_status ?? d.subscription?.subscription_status,
      raw: body,
    };
  }

  static sign(secretKey: string, timestamp: string, rawBody: string) {
    return createHmac("sha256", secretKey).update(timestamp + rawBody).digest("base64");
  }
}

/** Use Cashfree when keys are set; otherwise leave the fake gateway in place. Returns whether Cashfree is active. */
export function registerCashfree(): boolean {
  const e = env();
  if (!e.CASHFREE_APP_ID || !e.CASHFREE_SECRET_KEY) return false;
  registerPaymentGateway(() => new CashfreePaymentGateway({ appId: e.CASHFREE_APP_ID!, secretKey: e.CASHFREE_SECRET_KEY!, mode: e.CASHFREE_ENV }));
  return true;
}
