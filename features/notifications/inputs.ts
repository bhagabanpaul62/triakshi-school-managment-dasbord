import { z } from "zod";
import { NOTIFICATION_KINDS } from "./schema";

export const notificationPayload = z.object({
  kind: z.enum(NOTIFICATION_KINDS).default("system"),
  title: z.string().trim().min(1, "Add a title").max(160),
  body: z.string().trim().max(1000).optional(),
  href: z.string().trim().max(300).regex(/^\/app(\/|$)/, "Link must be inside the app").optional(),
});
export type NotificationPayload = z.input<typeof notificationPayload>;
