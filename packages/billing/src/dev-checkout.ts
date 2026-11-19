import { isLocal } from "@smw/config";
import { eq, payments, withConsole } from "@smw/db";
import { NotFoundError } from "@smw/feature-kit";
import { FAKE_FAILED, FAKE_PAID_PREFIX } from "./gateway";
import { PlatformBilling } from "./platform-billing";

/** What the "Pay (test)" / "Fail (test)" buttons do. Local development only; refuses to run in production. */
export class DevCheckout {
  static async order(orderId: string) {
    if (!isLocal()) throw new NotFoundError("Page");
    const [p] = await withConsole((tx) => tx.select().from(payments).where(eq(payments.gatewayOrderId, orderId)).limit(1));
    if (!p) throw new NotFoundError("Order");
    return p;
  }

  /** Marks the fake order paid or failed in the payments table, then runs the real confirm path. */
  static async settle(orderId: string, outcome: "pay" | "fail") {
    const p = await this.order(orderId);
    await withConsole((tx) => tx.update(payments).set(outcome === "pay" ? { gatewayPaymentId: `${FAKE_PAID_PREFIX}${orderId}` } : { reference: FAKE_FAILED }).where(eq(payments.id, p.id)));
    return PlatformBilling.system().confirmOrder(orderId);
  }
}
