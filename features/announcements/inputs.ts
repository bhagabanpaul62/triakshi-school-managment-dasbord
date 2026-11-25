import { z } from "zod";
import { audienceField } from "@smw/feature-notifications/audience-rules";
import { ANSWER_FILTERS, NOTICE_TABS, NOTICE_TYPES, QUESTION_KINDS, RELATIONS, MAX_QUESTIONS } from "./constants";

/** Dates arrive as ISO text (the form converts IST wall time) or Date; "" and null clear. */
const when = z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.date().nullable());
/** A JSON field from a form, or the object itself. */
const json = <T extends z.ZodType>(s: T) => z.preprocess((v) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return undefined; } }, s);
const flag = z.preprocess((v) => (v === "true" || v === "on" || v === "1" ? true : v === "false" || v === "0" || v === "" ? false : v), z.boolean());
const optionText = z.string().trim().min(1, "Write the choice").max(80);

export const questionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1, "Write the question").max(200),
  kind: z.enum(QUESTION_KINDS),
  required: z.boolean().default(true),
  options: z.array(optionText).max(20).optional(),
}).refine((q) => q.kind !== "choice" || (q.options?.length ?? 0) >= 2, { message: "Give at least two choices", path: ["options"] });

export const responseSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("ack") }),
  z.object({ kind: z.literal("consent"), reasonForNo: z.boolean().default(false) }),
  z.object({ kind: z.literal("poll"), options: z.array(optionText).min(2, "Give at least two choices").max(10), multiple: z.boolean().default(false) }),
  z.object({ kind: z.literal("form"), questions: z.array(questionSchema).min(1, "Add a question").max(MAX_QUESTIONS, `Up to ${MAX_QUESTIONS} questions`) }),
]);

export const answerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ack") }),
  z.object({ kind: z.literal("consent"), yes: z.boolean(), reason: z.string().trim().max(500).optional() }),
  z.object({ kind: z.literal("poll"), choices: z.array(z.string().trim().max(80)).min(1, "Choose an option").max(10) }),
  z.object({ kind: z.literal("form"), values: z.record(z.string().max(80), z.string().max(2000)) }),
]);

/** Every field optional: an autosaved draft is allowed to be half written. */
export const draftInput = z.object({
  id: z.uuid().optional(),
  type: z.enum(NOTICE_TYPES),
  categoryId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable()),
  title: z.string().trim().max(160, "Keep the title under 160 characters"),
  body: z.string().max(10_000, "Keep it under 10,000 characters"),
  lang2: z.string().trim().max(30).nullable(),
  title2: z.string().trim().max(160).nullable(),
  body2: z.string().max(10_000).nullable(),
  audience: audienceField,
  /** True: no one is messaged, the notice goes on the website only. */
  websiteOnly: flag,
  response: json(responseSpecSchema),
  dueAt: when,
  reminders: json(z.object({ before: z.boolean(), onDay: z.boolean(), after: z.boolean() })),
  website: flag,
  scheduledAt: when,
  expiresAt: when,
  pinnedUntil: when,
}).partial();
export type DraftInput = z.infer<typeof draftInput>;

/** What a correction or an approver's edit may change. The type, the schedule and the id stay put. */
export const editInput = draftInput.omit({ id: true, type: true, scheduledAt: true });
export type EditInput = z.infer<typeof editInput>;

export const correctInput = z.object({ id: z.uuid(), note: z.string().trim().max(300).optional(), edits: editInput });
export const approveInput = z.object({ id: z.uuid(), reason: z.string().trim().max(300).optional(), edits: editInput.optional() });
export const noteInput = z.object({ id: z.uuid(), note: z.string().trim().min(3, "Say what to change").max(500) });
export const reasonInput = z.object({ id: z.uuid(), reason: z.string().trim().min(3, "Give a reason").max(300) });

export const listInput = z.object({
  tab: z.enum(NOTICE_TABS).default("live"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  category: z.uuid().optional(),
  type: z.enum(NOTICE_TYPES).optional(),
  author: z.uuid().optional(),
  needs: z.literal("answer").optional(),
  /** What its audience includes: everyone, families, staff, or `class:<id>` / `section:<id>`. */
  audience: z.string().regex(/^(everyone|families|staff|(class|section):[0-9a-f-]{36})$/i).optional(),
  /** IST days, both included. Compared with when it went out (or is due to, or was last saved). */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});
export type NoticeListQuery = z.input<typeof listInput>;

export const feedInput = z.object({
  tab: z.enum(["inbox", "archive"]).default("inbox"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  category: z.uuid().optional(),
});
export type FeedQuery = z.input<typeof feedInput>;

export const respondInput = z.object({
  noticeId: z.uuid(),
  /** Needed only when the login is the family of more than one child. */
  recipientId: z.uuid().optional(),
  answer: answerSchema,
  /** Both may be left out for "I am safe" on an urgent alert: the family is asked once it is saved. */
  byName: z.string().trim().max(80).optional(),
  byRelation: z.enum(RELATIONS, { error: "Say who you are" }).optional(),
});
export const paperInput = z.object({
  noticeId: z.uuid(),
  recipientId: z.uuid(),
  answer: answerSchema,
  byName: z.string().trim().min(2, "Write the name of who answered").max(80),
  byRelation: z.enum(RELATIONS, { error: "Say who answered" }),
});

export const peopleInput = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(100).optional(),
  filter: z.enum(ANSWER_FILTERS).optional(),
  sectionId: z.uuid().optional(),
});
export type PeopleQuery = z.input<typeof peopleInput>;

export const categoryInput = z.object({
  name: z.string().trim().min(2, "Give it a name").max(40),
  tone: z.enum(["default", "info", "success", "warning"]).default("default"),
  sort: z.coerce.number().int().min(0).max(1000).default(0),
  active: flag.default(true),
});
export const categoryUpdate = categoryInput.partial();

export const templateInput = z.object({ name: z.string().trim().min(2, "Give it a name").max(60), draft: json(editInput.extend({ type: z.enum(NOTICE_TYPES).optional() })) });
