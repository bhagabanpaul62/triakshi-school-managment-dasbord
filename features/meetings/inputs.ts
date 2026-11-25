import { z } from "zod";
import { f } from "@smw/feature-kit";
import { audienceField } from "@smw/feature-notifications/audience-rules";
import { parseIstInput } from "./rules";

const when = (msg: string) => z.preprocess((v) => parseIstInput(v) ?? undefined, z.date({ message: msg }));
const hm = (msg: string) => z.string({ message: msg }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, msg);
const optHm = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 13:00").optional());
const optUrl = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.url({ message: "Enter a full web address" }).max(300).refine((u) => /^https?:\/\//.test(u), "Use a web address that starts with https://").optional());

export const meetingInput = z.object({
  title: f.text(3, 120, "Give the meeting a name"),
  note: f.optText(1000),
  audience: audienceField,
  slotMinutes: f.int(5, 30),
  perFamily: f.int(1, 20),
  opensAt: when("Pick when booking opens"),
  closesAt: when("Pick when booking closes"),
}).superRefine((d, ctx) => {
  if (d.closesAt <= d.opensAt) ctx.addIssue({ code: "custom", path: ["closesAt"], message: "Booking must close after it opens" });
});

const windowFields = {
  day: f.date("Pick the day"),
  from: hm("Pick the start time"),
  to: hm("Pick the end time"),
  place: f.optText(120),
  videoUrl: optUrl,
  breakFrom: optHm,
  breakTo: optHm,
};
const ordered = (d: { from?: string; to?: string; breakFrom?: string; breakTo?: string }, ctx: z.RefinementCtx) => {
  if (d.from && d.to && d.to <= d.from) ctx.addIssue({ code: "custom", path: ["to"], message: "The end must be after the start" });
  if (!!d.breakFrom !== !!d.breakTo) ctx.addIssue({ code: "custom", path: ["breakTo"], message: "Give both the break start and end" });
  if (d.breakFrom && d.breakTo && d.breakTo <= d.breakFrom) ctx.addIssue({ code: "custom", path: ["breakTo"], message: "The break must end after it starts" });
};

/** The same window for every teacher in `teacherIds`. */
export const windowsInput = z.object({ teacherIds: f.list().pipe(z.array(z.uuid("Choose teachers")).min(1, "Choose at least one teacher").max(200)), ...windowFields })
  .superRefine(ordered);

/** Any field left out stays as it is. `noBreak` removes the breaks. */
export const changeWindowInput = z.object({
  day: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  from: optHm, to: optHm, place: f.optText(120), videoUrl: optUrl, breakFrom: optHm, breakTo: optHm,
  noBreak: f.bool(),
  /** The caller has seen the list of bookings this drops. */
  confirm: f.bool(),
}).superRefine(ordered);

/** The caller has seen the list of bookings a removal drops. */
export const confirmInput = z.object({ confirm: f.bool() });
export const cancelInput = z.object({ reason: f.text(3, 300, "Say why, families will read it") });
export const reopenInput = z.object({ closesAt: z.preprocess((v) => parseIstInput(v) ?? undefined, z.date().optional()) });
export const duplicateInput = z.object({ title: f.optText(120), date: f.date("Pick the new date") });

export const bookInput = z.object({ slotId: f.id("Pick a time"), studentId: f.optId() });
export const changeBookingInput = z.object({ fromSlotId: f.id("Pick the booking to change"), toSlotId: f.id("Pick a new time"), studentId: f.optId() });
export const waitInput = z.object({ teacherId: f.id("Pick a teacher"), studentId: f.optId() });

const visit = z.preprocess((v) => (v === "" || v == null ? undefined : v), z.enum(["came", "missed", "late"]).optional());
export const visitInput = z.object({ visit });
/** A field that is missing stays as it is; an empty one clears it. */
export const noteInput = z.object({ privateNote: z.string().trim().max(2000, "Keep it under 2000 characters").optional(), sharedRemark: z.string().trim().max(1000, "Keep it under 1000 characters").optional() });
export const walkInInput = z.object({ studentId: f.id("Pick the child"), teacherId: f.optId() });
