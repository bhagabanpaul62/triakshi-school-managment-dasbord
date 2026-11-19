import { env, fakePayments } from "@smw/config";
import { eq, payments, withConsole } from "@smw/db";
import { FakePaymentGateway, registerPaymentGateway, type OrderStatus } from "@smw/integrations";
import { registerCashfree } from "@smw/integrations";

export { WebhookSignatureError } from "@smw/integrations";

export const FAKE_PAID_PREFIX = "fakepay_";
export const FAKE_FAILED = "fake_failed";

/**
 * Local gateway without Cashfree keys. Unlike the in-memory fake, its order state lives in the payments table,
 * so the school app (which creates the order) and the console dev page (which "pays" it) agree across processes.
 */
export class DbFakeGateway extends FakePaymentGateway {
  constructor() { super(env().CONSOLE_URL); }

  override async getOrderStatus(orderId: string) {
    const [p] = await withConsole((tx) => tx.select().from(payments).where(eq(payments.gatewayOrderId, orderId)).limit(1));
    if (!p) return { status: "ACTIVE" as OrderStatus, amountPaise: 0, paymentId: undefined as string | undefined };
    if (p.gatewayPaymentId?.startsWith(FAKE_PAID_PREFIX)) return { status: "PAID" as OrderStatus, paymentId: p.gatewayPaymentId as string | undefined, amountPaise: p.amountPaise };
    if (p.reference === FAKE_FAILED) return { status: "TERMINATED" as OrderStatus, amountPaise: p.amountPaise, paymentId: undefined as string | undefined };
    return { status: "ACTIVE" as OrderStatus, amountPaise: p.amountPaise, paymentId: undefined as string | undefined };
  }
}

let done = false;
/** Pick the payment gateway once per process: Cashfree with keys, the DB-backed fake locally, nothing in production without keys. */
export function ensureGateway() {
  if (done) return;
  done = true;
  if (registerCashfree()) return;
  registerPaymentGateway(() => {
    if (!fakePayments()) throw new Error("Payments are not configured: set CASHFREE_APP_ID and CASHFREE_SECRET_KEY.");
    return new DbFakeGateway();
  });
}
