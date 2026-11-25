// Input shapes for holidays. No database: safe to import from forms and client components.
import { z } from "zod";
import { f } from "@smw/feature-kit";
import { HOLIDAY_KINDS, type HolidayKind, type HolidayScope } from "./constants";
import { addDays, isDate } from "./stats";

export const HOLIDAY_SCOPES: Record<HolidayScope, string> = { all: "Everyone (students and staff)", students: "Students only", classes: "Chosen classes only" };
export const KIND_KEYS = Object.keys(HOLIDAY_KINDS) as [HolidayKind, ...HolidayKind[]];
export const MAX_SPAN_DAYS = 100;

const ids = z.preprocess((v) => (v == null || v === "" ? [] : Array.isArray(v) ? v : [v]), z.array(z.uuid("Choose classes")).max(60));

/** One holiday, or one break of several days. `to` empty means a single day. */
export const holidayInput = z.object({
  from: f.date("Pick the first day"),
  to: f.optDate(),
  name: f.text(2, 80, "Name the holiday"),
  kind: z.enum(KIND_KEYS, { message: "Pick a kind" }).default("other"),
  appliesTo: z.enum(["all", "students", "classes"], { message: "Pick who is off" }).default("all"),
  classIds: ids,
  note: f.optText(300),
  /** Tell everyone it affects (only when it starts today or later). */
  notify: f.bool(),
}).refine((v) => isDate(v.from), { path: ["from"], message: "Pick a real date" })
  .refine((v) => !v.to || (isDate(v.to) && v.to >= v.from), { path: ["to"], message: "The last day is before the first day" })
  .refine((v) => !v.to || v.to <= addDays(v.from, MAX_SPAN_DAYS - 1), { path: ["to"], message: `A break can be at most ${MAX_SPAN_DAYS} days. Add the next part separately.` })
  .refine((v) => v.appliesTo !== "classes" || v.classIds.length > 0, { path: ["classIds"], message: "Choose at least one class" })
  .transform(({ to, classIds, ...v }) => ({ ...v, to: to ?? v.from, classIds: v.appliesTo === "classes" ? classIds : [] }));

export type HolidayData = z.output<typeof holidayInput>;

const json = (v: unknown) => { if (typeof v !== "string") return v; try { return JSON.parse(v); } catch { return undefined; } };

/** Several holidays at once (copy last year, the ready list): the form sends them as one JSON field. All or nothing. */
export const holidayBatchInput = z.object({
  items: z.preprocess(json, z.array(holidayInput, { message: "Tick at least one day" }).min(1, "Tick at least one day").max(200)),
  notify: f.bool(),
});
