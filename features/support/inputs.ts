import { z } from "zod";
import { f } from "@smw/feature-kit";

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;

export const ticketInput = z.object({
  subject: f.text(3, 150, "Say what this is about"),
  body: f.text(1, 5000, "Describe the problem or question"),
  priority: z.preprocess((v) => v || "normal", z.enum(TICKET_PRIORITIES)),
});

export const replyInput = z.object({ body: f.text(1, 5000, "Write a message") });
