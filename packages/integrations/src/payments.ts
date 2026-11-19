// Payment gateway contract (Cashfree in production). Amounts are integer paise.

export interface CheckoutOrder { orderId: string; amountPaise: number; customer: { id: string; name: string; email: string; phone: string }; returnUrl: string; notifyUrl: string; note?: string }
export interface CreatedOrder { orderId: string; paymentSessionId: string; checkoutUrl: string }
export type OrderStatus = "ACTIVE" | "PAID" | "EXPIRED" | "TERMINATED";

export interface SubscriptionRequest { subscriptionId: string; planName: string; amountPaise: number; intervalMonths: number; customer: CheckoutOrder["customer"]; returnUrl: string; notifyUrl: string }
export interface CreatedSubscription { subscriptionId: string; checkoutUrl: string }

export interface WebhookEvent { id: string; type: string; orderId?: string; subscriptionId?: string; paymentId?: string; amountPaise?: number; status?: string; raw: unknown }

export interface PaymentGateway {
  readonly name: "cashfree" | "fake";
  createOrder(o: CheckoutOrder): Promise<CreatedOrder>;
  /** Ask the gateway, never trust a redirect. */
  getOrderStatus(orderId: string): Promise<{ status: OrderStatus; paymentId?: string; amountPaise: number }>;
  createSubscription(s: SubscriptionRequest): Promise<CreatedSubscription>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  /** Verify the signature and parse the event; throws on a bad signature. */
  parseWebhook(rawBody: string, headers: Record<string, string | undefined>): WebhookEvent;
}

/** In-memory gateway for tests and for local runs without Cashfree keys. Checkout pages are served by the console at /dev/fake-checkout. */
export class FakePaymentGateway implements PaymentGateway {
  readonly name = "fake" as const;
  readonly orders = new Map<string, { amountPaise: number; status: OrderStatus }>();
  constructor(private readonly baseUrl = "http://localhost:4102") {}
  async createOrder(o: CheckoutOrder) {
    this.orders.set(o.orderId, { amountPaise: o.amountPaise, status: "ACTIVE" });
    return { orderId: o.orderId, paymentSessionId: `fake_${o.orderId}`, checkoutUrl: `${this.baseUrl}/dev/fake-checkout?order=${o.orderId}&return=${encodeURIComponent(o.returnUrl)}` };
  }
  async getOrderStatus(orderId: string) {
    const o = this.orders.get(orderId);
    return { status: o?.status ?? "ACTIVE", amountPaise: o?.amountPaise ?? 0, paymentId: o?.status === "PAID" ? `fakepay_${orderId}` : undefined };
  }
  markPaid(orderId: string) { const o = this.orders.get(orderId); if (o) o.status = "PAID"; }
  async createSubscription(s: SubscriptionRequest) {
    return { subscriptionId: s.subscriptionId, checkoutUrl: `${this.baseUrl}/dev/fake-checkout?subscription=${s.subscriptionId}&return=${encodeURIComponent(s.returnUrl)}` };
  }
  async cancelSubscription() {}
  parseWebhook(rawBody: string): WebhookEvent {
    const j = JSON.parse(rawBody) as WebhookEvent;
    return { ...j, raw: j };
  }
}
