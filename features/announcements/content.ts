// What a notice says (the part a version keeps), and the rules that say it is ready to send. Pure.
import { markdownToText } from "@smw/ui/markdown";
import { isEveryone, type Audience } from "@smw/feature-notifications/audience-rules";
import type { NoticeType, Reminders, ResponseSpec } from "./constants";
import type { announcements } from "./schema";

export type Notice = typeof announcements.$inferSelect;

export interface NoticeContent {
  type: NoticeType; categoryId: string | null; title: string; body: string; lang2: string | null; title2: string | null; body2: string | null;
  audience: Audience; response: ResponseSpec; dueAt: Date | null; reminders: Reminders; website: boolean; scheduledAt: Date | null; expiresAt: Date | null; pinnedUntil: Date | null;
}
export const CONTENT_KEYS = ["type", "categoryId", "title", "body", "lang2", "title2", "body2", "audience", "response", "dueAt", "reminders", "website", "scheduledAt", "expiresAt", "pinnedUntil"] as const;

export const NO_AUDIENCE: Audience = { include: [], exclude: [] };
export const EMPTY: NoticeContent = {
  type: "notice", categoryId: null, title: "", body: "", lang2: null, title2: null, body2: null, audience: NO_AUDIENCE, response: { kind: "none" },
  dueAt: null, reminders: { before: true, onDay: true, after: true }, website: false, scheduledAt: null, expiresAt: null, pinnedUntil: null,
};

export const contentOf = (n: Notice): NoticeContent => Object.fromEntries(CONTENT_KEYS.map((k) => [k, n[k]])) as unknown as NoticeContent;
/** The JSON a version keeps. */
export const snapshotOf = (n: Notice): Record<string, unknown> => JSON.parse(JSON.stringify(contentOf(n)));

/** No one is messaged: the notice only goes on the website. */
export const isWebsiteOnly = (c: Pick<NoticeContent, "audience" | "website">) => c.website && c.audience.include.length === 0;
/** The only audiences that may go on the website. */
export const publicAudience = (a: Audience) => a.include.length === 0 || isEveryone(a);
/** The text that goes in the bell and in the app. */
export const plain = (c: Pick<NoticeContent, "body">, max = 200) => markdownToText(c.body, max);
/** Bell and list text: one run of sentences, no dashes or numbers (each list item becomes a sentence). */
export const sentences = (c: Pick<NoticeContent, "body">, max = 200) => {
  const t = markdownToText(c.body).split("\n").map((l) => l.replace(/^(?:-|\d+\.) /, "").trim()).filter(Boolean).map((l) => (/[.!?।:]$/.test(l) ? l : `${l}.`)).join(" ");
  return Array.from(t).length <= max ? t : Array.from(t).slice(0, max - 1).join("").trimEnd() + "…";
};

/** Why a notice is not ready to send, by field. Empty when it is. */
export function readyErrors(c: NoticeContent, o: { languages: readonly string[]; categoryName: string | null }): Record<string, string> {
  const e: Record<string, string> = {};
  if (c.title.trim().length < 3) e.title = "Give it a title";
  if (!markdownToText(c.body).trim()) e.body = "Write the notice";
  if (!c.audience.include.length && !isWebsiteOnly(c)) e.audience = "Choose who it is for";
  if (c.lang2 || c.title2 || c.body2) {
    if (!c.lang2 || !o.languages.includes(c.lang2)) e.lang2 = "Choose a language the school has turned on";
    if (!c.title2?.trim()) e.title2 = "Write the title in this language";
    if (!c.body2?.trim()) e.body2 = "Write the notice in this language";
  }
  if (c.type === "urgent" && o.categoryName?.toLowerCase() === "fees") e.type = "An urgent alert cannot be about fees";
  if (c.type === "urgent" && c.response.kind === "none") e.response = "An urgent alert asks people to confirm they are safe";
  if (c.website && !publicAudience(c.audience)) e.website = "Only a notice for everyone can go on the website";
  if (c.dueAt && c.response.kind === "none") e.dueAt = "A due date needs something to answer";
  if (c.expiresAt && c.expiresAt.getTime() < Date.now()) e.expiresAt = "Choose a date that has not passed";
  return e;
}

/** The answer asked of people, in a few words for lists. */
export const RESPONSE_WORDS: Record<ResponseSpec["kind"], string> = { none: "", ack: "Confirm you have read it", consent: "Yes or no", poll: "Pick an option", form: "Fill a short form" };
