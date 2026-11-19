"use server";

import { OfflinePaymentService } from "@smw/billing";
import { formToObject } from "@smw/runtime";
import { consoleAction } from "@/lib/console-action";

export async function recordOfflinePayment(fd: FormData) {
  return consoleAction(OfflinePaymentService, (s) => s.record(formToObject(fd)), "Payment recorded");
}
