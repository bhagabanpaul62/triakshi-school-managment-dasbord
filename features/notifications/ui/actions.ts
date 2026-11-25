"use server";

import { serviceAction } from "@smw/runtime";
import { NotificationService } from "../service";

export async function markNotificationRead(id: string) {
  return serviceAction(NotificationService, (s) => s.markRead(String(id)));
}
export async function markAllNotificationsRead() {
  return serviceAction(NotificationService, (s) => s.markRead("all"), "All caught up");
}
