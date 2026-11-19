"use server";

import { BillingService } from "@smw/billing";
import { formToObject, serviceAction } from "@smw/runtime";

/** Returns { kind: "checkout", checkoutUrl } for the browser to open, or { kind: "scheduled" } for a downgrade. */
export async function startCheckout(fd: FormData) {
  return serviceAction(BillingService, (s) => s.startCheckout(formToObject(fd)));
}

export async function payInvoice(fd: FormData) {
  return serviceAction(BillingService, (s) => s.payInvoice(String(fd.get("id") ?? "")));
}
