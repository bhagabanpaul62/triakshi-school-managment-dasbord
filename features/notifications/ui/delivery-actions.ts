"use server";

import { serviceAction } from "@smw/runtime";
import { DeliveryService, PushTestService } from "../delivery";
import { PreferenceService } from "../prefs";

export async function retryFailedDeliveries() {
  return serviceAction(DeliveryService, async (s) => ({ count: await s.retry("all") }), "Failed messages will be tried again within a minute");
}

export async function allowAddressAgain(fd: FormData) {
  const address = String(fd.get("address") ?? "");
  return serviceAction(DeliveryService, (s) => s.worksAgain(address), "Emails will go to this address again");
}

/** Called by the browser after it has the device's push keys. */
export async function subscribeDevice(sub: { endpoint: string; p256dh: string; auth: string; device?: string }) {
  return serviceAction(PreferenceService, (s) => s.subscribe(String(sub.endpoint), String(sub.p256dh), String(sub.auth), sub.device ? String(sub.device) : undefined), "Notifications are on for this device");
}

export async function sendTestPush() {
  return serviceAction(PushTestService, (s) => s.send(), "Test sent. It should show up in a moment.");
}
