"use server";

import { serviceAction } from "@smw/runtime";
import { NotificationService } from "../service";

export async function markNotificationRead(id: string) {
  return serviceAction(NotificationService, (s) => s.markRead(String(id)));
}
export async function markAllNotificationsRead() {
  return serviceAction(NotificationService, (s) => s.markRead("all"), "All caught up");
}
export async function setEmailDigest(fd: FormData) {
  return serviceAction(NotificationService, (s) => s.setEmailDigest(fd.get("enabled") === "true"), "Preference saved");
}
