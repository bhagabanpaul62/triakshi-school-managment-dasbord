import { z } from "zod";
import { f } from "@smw/feature-kit";
import { ENQUIRY_KINDS, ENQUIRY_STATUSES, TASK_KINDS } from "./schema";
import { normalizePhone } from "@smw/site-templates";
import { CALL_OUTCOMES, enquirySettingsSchema } from "./enquiry-core";

const when = z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, "Pick a date and time");
/** "2026-11-25T10:30" from a datetime-local box, read as IST. */
export const istTime = (v: string) => new Date(v.length === 10 ? `${v}T10:00:00+05:30` : `${v}:00+05:30`);
const optWhen = z.preprocess((v) => (v === "" || v === null ? undefined : v), when.optional());

const blank = (v: unknown) => (v === "" || v === null ? undefined : v);
/** One rule for the browser and the server (+91, 91, 0, brackets, spaces; a landline keeps its area code). */
const digits = z.string().regex(/^\d{10,11}$/, "Enter a 10 digit mobile number, or a landline with its area code");
const tidy = (v: unknown) => (typeof v === "string" ? normalizePhone(v) ?? v : v);
export const mobile = () => z.preprocess(tidy, digits);
const optMobile = () => z.preprocess((v) => tidy(blank(v)), digits.optional());
/** The facts of one enquiry, as staff type them (and the import reads them). */
const person = {
  studentName: f.text(2, 100, "Enter the child's name"),
  dob: f.optDate(),
  gender: f.optText(10),
  classApplying: f.optText(40),
  session: f.optText(9),
  previousSchool: f.optText(120),
  parentName: f.text(2, 100, "Enter the parent's name"),
  relation: f.optText(20),
  phone: mobile(),
  altPhone: optMobile(),
  email: f.optEmail(),
  address: f.optText(300),
  message: f.optText(1000),
  source: f.optText(40),
  campaign: f.optText(80),
  tags: z.preprocess((v) => (typeof v === "string" ? v.split(",") : v ?? []), z.array(z.string().trim().min(1).max(30)).max(10)),
  priority: f.bool(),
};

/** Staff adding an enquiry by hand (a call, a walk-in). The first next step is made for them unless they choose one. */
export const manualEnquiryInput = z.object({
  ...person,
  kind: z.enum(ENQUIRY_KINDS).default("admission"),
  nextKind: z.enum(TASK_KINDS).default("call"),
  nextOn: optWhen,
});
export const enquiryEditInput = z.object(person);

export const moveInput = z.object({
  to: z.enum(ENQUIRY_STATUSES),
  reason: f.optText(100),
  /** The stage the person saw. When somebody moved it meanwhile, nothing changes and they are told. */
  from: z.preprocess((v) => (v === "" ? undefined : v), z.enum(ENQUIRY_STATUSES).optional()),
});

export const callInput = z.object({
  outcome: z.enum(Object.keys(CALL_OUTCOMES) as [keyof typeof CALL_OUTCOMES, ...(keyof typeof CALL_OUTCOMES)[]], { error: "Choose how the call went" }),
  note: f.optText(1000),
  /** For "call later". */
  laterAt: optWhen,
});

export const taskInput = z.object({
  kind: z.enum(TASK_KINDS),
  dueAt: when,
  title: f.optText(100),
  ownerId: f.optId(),
});
/** Finishing the last open step asks for the next one, or closes the enquiry. */
export const doneInput = z.object({ outcome: f.text(1, 200, "Say how it went"), nextKind: z.preprocess(blank, z.enum(TASK_KINDS).optional()), nextOn: optWhen, closeReason: f.optText(100) });
export const savedViewInput = z.object({ name: f.text(1, 30, "Name the view"), query: z.string().trim().max(300).regex(/^[\w%.=&:+\-, ]*$/, "This view cannot be saved") });
export const visitInput = z.object({ at: when, note: f.optText(300) });
export const visitedInput = z.object({ note: f.optText(500), nextOn: optWhen });
export const noteInput = z.object({ text: f.text(1, 2000, "Write the note") });

export const messageInput = z.object({
  template: f.optText(30),
  subject: f.optText(120),
  text: f.optText(2000),
  /** The visit time the {visit} word means, when the message is about one. */
  visit: optWhen,
});

export const bulkInput = z.object({
  ids: z.array(z.uuid()).min(1, "Choose at least one enquiry").max(200, "Choose up to 200 at a time"),
  action: z.enum(["assign", "stage", "close"]),
  ownerId: f.optId(),
  to: z.enum(ENQUIRY_STATUSES).optional(),
  reason: f.optText(100),
});

export const mergeInput = z.object({ keepId: z.uuid(), otherId: z.uuid() });

/** Seats on offer for a class in a session. */
export const seatsInput = z.object({
  rows: z.array(z.object({ session: f.text(4, 9), className: f.text(1, 40), seats: f.int(0, 5000) })).max(300),
});

export const settingsInput = enquirySettingsSchema.partial();

/** One row of the fair's spreadsheet. Columns are the template's. */
export const importRowInput = z.object({
  studentName: person.studentName, dob: person.dob, classApplying: person.classApplying, parentName: person.parentName,
  phone: person.phone, email: person.email, source: person.source, message: person.message,
});
