import { z } from "zod";
import { f } from "@smw/feature-kit";
import { audienceField } from "@smw/feature-notifications/audience-rules";
import { BODY_MAX, REPORT_CATEGORIES, REPORT_STATES } from "./constants";

const text = z.preprocess((v) => v ?? "", z.string().max(BODY_MAX, `Keep it under ${BODY_MAX} characters`));
const subject = f.text(2, 120, "Add a subject");
const clientId = f.optText(80);
const category = z.enum(Object.keys(REPORT_CATEGORIES) as [keyof typeof REPORT_CATEGORIES, ...(keyof typeof REPORT_CATEGORIES)[]], { error: "Choose what happened" });

/** The message may be empty when files are attached; the service checks that. */
export const sendInput = z.object({ threadId: f.id("Pick a conversation"), body: text, clientId });

export const startInput = z.object({
  /** The student a staff member writes about, or a family's own child. */
  studentId: f.optId(),
  recipientIds: f.list().pipe(z.array(z.uuid("Choose one")).max(10, "Pick up to 10 people")),
  subject,
  body: text,
  clientId,
});

export const reportInput = z.object({
  threadId: f.id(),
  /** Set when the concern is about one message. */
  messageId: f.optId(),
  category,
  note: f.text(3, 1000, "Say what happened"),
  /** A person named in the concern, beyond the sender of the message. */
  aboutUserId: f.optId(),
});

export const handleReportInput = z.object({
  reportId: f.id(),
  state: z.enum(REPORT_STATES.filter((s) => s !== "new") as ["reviewing", "action", "no_action"], { error: "Choose what happened" }),
  outcome: f.optText(1000),
});

export const reviewInput = z.object({ threadId: f.id(), reason: f.text(5, 500, "Type why you are opening this conversation"), reportId: f.optId() });

export const restrictInput = z.object({
  userId: f.id("Choose a person"),
  kind: z.enum(["reply_only", "blocked"], { error: "Choose how far to limit" }),
  reason: f.text(5, 500, "Type the reason"),
  until: f.date("Pick the last day"),
});

export const savedReplyInput = z.object({ title: f.text(2, 60, "Add a short title"), body: f.text(2, BODY_MAX, "Write the reply"), shared: f.bool() });

export const batchInput = z.object({ audience: audienceField, subject, body: f.text(1, BODY_MAX, "Write a message"), clientId: f.text(8, 80, "Reload the page and try again") });
