import { z } from "zod";
import { f } from "@smw/feature-kit";

const body = f.text(1, 4000, "Write a message");

export const sendInput = z.object({ threadId: f.id("Pick a conversation"), body });

export const startInput = z.object({
  recipientIds: f.list().pipe(z.array(z.uuid("Choose one")).min(1, "Pick at least one person").max(30, "Pick up to 30 people")),
  subject: f.text(2, 120, "Add a subject"),
  body,
});
