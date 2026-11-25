import { z } from "zod";
import { answerInput } from "@smw/feature-events/inputs";
import { bookInput, changeBookingInput } from "@smw/feature-meetings/inputs";
import { digestInput, groupPrefInput, languageInput, awayInput, quietInput } from "@smw/feature-notifications/inputs";
import { respondInput } from "@smw/feature-announcements/inputs";
import { f } from "@smw/feature-kit";
import { BODY_MAX } from "@smw/feature-messages/constants";
import { sendInput } from "@smw/feature-messages/inputs";

export const loginBody = z.object({
  identifier: z.string().trim().min(1, "Enter your login ID, email or phone").max(200),
  password: z.string().min(1, "Enter your password").max(200),
});
export type LoginBody = z.infer<typeof loginBody>;

export const changePasswordBody = z.object({
  currentPassword: z.string().min(1, "Enter your current password").max(200),
  newPassword: z.string().min(1, "Enter a new password").max(200),
});

/** A family's answer to a notice. `recipientId` is needed only when the login has two or more children. */
export const respondBody = respondInput.omit({ noticeId: true });

export const inboxQuery = z.object({
  view: z.enum(["all", "unread", "archived"]).optional(),
  studentId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
});
export const sendBody = sendInput.omit({ threadId: true });

/** Staff answer; a family writes back. */
export const answerBody = z.object({ body: f.text(1, BODY_MAX, "Write a few words") });

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
/** Calendar window in India dates; `to` is the last day shown. At most 93 days, so one call stays small. */
export const calendarQuery = z.object({
  from: day.optional(), to: day.optional(),
  layers: z.string().max(100).optional().describe("Comma-separated layers, default all you may see"),
});
export const CALENDAR_MAX_DAYS = 93;

export const rsvpBody = answerInput;
export const bookBody = bookInput;
export const changeBody = changeBookingInput;
export const cancelBookingBody = bookInput;

export const readBody = z.object({ id: z.uuid().optional(), all: z.literal(true).optional() })
  .refine((b) => !!b.id !== !!b.all, { message: "Send either id or all: true", path: ["id"] });

/** Any part may be sent; what is left out stays as it is. `quiet: null` clears quiet hours; `away: { until: null }` ends being away. */
export const prefsBody = z.object({
  groups: z.array(groupPrefInput).max(20).optional(),
  quiet: quietInput.optional(),
  digestHour: digestInput.optional(),
  language: languageInput.optional(),
  away: awayInput.optional(),
});

export const deviceBody = z.object({
  endpoint: z.string().max(1000), p256dh: z.string().max(200), auth: z.string().max(100), device: z.string().trim().max(80).optional(),
});
