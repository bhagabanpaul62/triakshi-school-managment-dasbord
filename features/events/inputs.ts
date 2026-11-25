import { z } from "zod";
import { f } from "@smw/feature-kit";
import { audienceField } from "@smw/feature-notifications/audience-rules";
import { DEFAULT_REMINDERS, EVENT_TYPES, REPEATS, type RepeatKind } from "./constants";
import { parseIst } from "./dates";

const blank = (v: unknown) => (v === "" || v === null ? undefined : v);
const toInstant = (v: unknown) => (typeof v === "string" ? parseIst(v) ?? v : v);
const when = z.preprocess(toInstant, z.date({ error: "Pick a date and time" }));
const optWhen = z.preprocess((v) => toInstant(blank(v)), z.date({ error: "Pick a date and time" }).optional());
const webLink = f.optText(300).refine((v) => !v || /^https?:\/\/[^\s]+$/i.test(v), "Use a link that starts with http:// or https://");

/** 0 stands for "no reminder": a form with every box empty still sends the field. */
const reminders = z.preprocess((v) => (v === undefined ? DEFAULT_REMINDERS : (Array.isArray(v) ? v : [v]).map(Number).filter((n) => n > 0)),
  z.array(z.number().int().min(5).max(43_200)).max(6, "Choose up to 6 reminders").transform((a) => [...new Set(a)].sort((x, y) => y - x)));

const shared = {
  title: f.text(3, 160, "Give it a title"),
  type: z.enum(Object.keys(EVENT_TYPES) as [keyof typeof EVENT_TYPES, ...(keyof typeof EVENT_TYPES)[]]).default("event"),
  description: f.optText(4000),
  startsAt: when,
  endsAt: optWhen,
  allDay: f.bool(),
  location: f.optText(160),
  mapUrl: webLink,
  bring: f.optText(500),
  audience: audienceField,
  isPublic: f.bool(),
  reminders,
  rsvpOn: f.bool(),
  capacity: f.optInt(1, 100_000),
  guests: f.optInt(0, 10),
  closesAt: optWhen,
  /** An app path of the notice that asks families' consent for a trip. */
  consentHref: f.optText(200).refine((v) => !v || /^\/app\/[^\s]*$/.test(v), "Use a link inside the app"),
};

type Shared = z.infer<z.ZodObject<typeof shared>>;
const shape = (v: Shared) => ({
  title: v.title, type: v.type, description: v.description ?? null, startsAt: v.startsAt, endsAt: v.endsAt ?? null, allDay: v.allDay,
  location: v.location ?? null, mapUrl: v.mapUrl ?? null, bring: v.bring ?? null, audience: v.audience, isPublic: v.isPublic, reminders: v.reminders,
  rsvp: v.rsvpOn ? { on: true as const, ...(v.capacity ? { capacity: v.capacity } : {}), ...(v.guests ? { guests: v.guests } : {}), ...(v.closesAt ? { closesAt: v.closesAt.toISOString() } : {}) } : { on: false as const },
  consentHref: v.consentHref ?? null,
});
const ends = (v: Shared) => !v.endsAt || v.endsAt >= v.startsAt;

export const updateInput = z.object(shared).refine(ends, { message: "It ends before it starts", path: ["endsAt"] }).transform(shape);

export const createInput = z.object({
  ...shared,
  repeat: z.enum(Object.keys(REPEATS) as [RepeatKind, ...RepeatKind[]]).default("none"),
  repeatUntil: f.optDate(),
  skipClosed: f.bool(),
  /** Tell the audience now. */
  notify: z.preprocess((v) => (v === undefined ? true : v === true || v === "true" || v === "on" || v === "1"), z.boolean()),
  /** Keep it private until it is published. */
  draft: f.bool(),
}).refine(ends, { message: "It ends before it starts", path: ["endsAt"] })
  .refine((v) => v.repeat === "none" || v.repeatUntil, { message: "Pick the last day", path: ["repeatUntil"] })
  .transform((v) => ({
    ...shape(v), notify: v.notify, draft: v.draft,
    repeat: v.repeat === "none" ? undefined : { kind: v.repeat, until: v.repeatUntil!, skipClosed: v.skipClosed },
  }));

export const cancelInput = z.object({ reason: f.text(3, 300, "Say why, so families know"), scope: z.enum(["this", "later", "all"]).default("this") });
export const scopeInput = z.enum(["this", "later", "all"]).default("this");
export const answerInput = z.object({ answer: z.enum(["yes", "maybe", "no"]), guests: f.int(0, 10).default(0) });

export type CreateInput = z.output<typeof createInput>;
export type UpdateInput = z.output<typeof updateInput>;
