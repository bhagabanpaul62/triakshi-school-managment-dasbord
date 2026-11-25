import { z } from "zod";
import { f } from "@smw/feature-kit/fields";
import { TICKET_FILE_RULES, TICKET_PRIORITIES } from "@smw/feature-kit/support-sla";

export { TICKET_PRIORITIES };
export const TICKET_CATEGORIES = ["question", "problem", "billing", "data", "onboarding", "idea", "closure"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const CATEGORY_LABELS: Record<TicketCategory, string> = {
  question: "A question", problem: "Something is not working", billing: "Billing and plan", data: "Our data (export, correction)",
  onboarding: "Getting started", idea: "An idea", closure: "Close our account",
};
/** Priority in the words a school uses. */
export const PRIORITY_LABELS: Record<TicketPriority, string> = { low: "Not urgent", normal: "Normal", high: "Blocking our work", urgent: "Everything is down" };
export const MAX_FILES = TICKET_FILE_RULES.maxFiles;
export const MAX_FILE_MB = TICKET_FILE_RULES.maxMb;

const path = z.preprocess((v) => (typeof v === "string" ? v.split(/[?#]/)[0]!.slice(0, 200) : v), z.string().regex(/^\/app(\/[\w\-./[\]]*)?$/, "Not a page of this app").optional());
/** What was caught when the ticket was written. A page is a path only: never a query, never a person's name. */
export const contextInput = z.object({
  page: z.preprocess((v) => (v === "" ? undefined : v), path),
  browser: f.optText(120),
  article: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^[a-z0-9-]{1,80}$/).optional()),
}).default({});

export const ticketInput = z.object({
  subject: f.text(3, 150, "Say what this is about"),
  body: f.text(1, 5000, "Describe the problem or question"),
  category: z.preprocess((v) => v || "question", z.enum(TICKET_CATEGORIES)),
  priority: z.preprocess((v) => v || "normal", z.enum(TICKET_PRIORITIES)),
  context: z.preprocess((v) => v ?? {}, contextInput),
  followUpOf: f.optId(),
});

export const replyInput = z.object({ body: f.text(1, 5000, "Write a message") });
export const ratingInput = z.object({ rating: f.int(1, 5), note: f.optText(500) });
export const voteInput = z.object({ article: z.string().regex(/^[a-z0-9-]{1,80}$/, "Not an article"), useful: f.bool() });
