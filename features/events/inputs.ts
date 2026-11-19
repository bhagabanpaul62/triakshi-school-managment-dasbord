import { z } from "zod";
import { f } from "@smw/feature-kit";
import { parseIst } from "./dates";
import { EVENT_AUDIENCES, EVENT_TONES } from "./schema";

const blank = (v: unknown) => (v === "" || v === null ? undefined : v);
const toInstant = (v: unknown) => (typeof v === "string" ? parseIst(v) ?? v : v);
const when = z.preprocess(toInstant, z.date({ error: "Pick a date and time" }));
const optWhen = z.preprocess((v) => toInstant(blank(v)), z.date({ error: "Pick a date and time" }).optional());

export const eventInput = z.object({
  title: f.text(3, 160, "Give it a title"),
  description: f.optText(2000),
  startsAt: when,
  endsAt: optWhen,
  allDay: f.bool(),
  location: f.optText(120),
  audience: z.enum(EVENT_AUDIENCES).default("all"),
  classId: f.optId(),
  isPublic: f.bool(),
  isHoliday: f.bool(),
  tone: z.enum(EVENT_TONES).default("default"),
})
  .refine((v) => v.audience !== "class" || v.classId, { message: "Pick the class", path: ["classId"] })
  .refine((v) => !v.endsAt || v.endsAt >= v.startsAt, { message: "It ends before it starts", path: ["endsAt"] });
