import { z } from "zod";
import { f } from "@smw/feature-kit";
import { BODY_MAX } from "@smw/feature-messages/constants";
import { MAX_ABOUT, MAX_LEVELS, MAX_QUESTIONS, NATURES, VIEWS } from "./constants";

const body = f.text(1, BODY_MAX, "Write a few words");
/** A link inside the app only. */
const appHref = z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\/app(\/|$)/).refine((h) => !h.includes("//"), "Not a valid link").max(300).optional());

/** The "about" link of an ask page: label and in-app path from the address bar, or null. */
export const linkFromQuery = (label: string, href: string) => { const h = appHref.safeParse(href); return label && h.success && h.data ? { label: label.slice(0, 80), href: h.data } : null; };

export const raiseInput = z.object({
  categoryId: f.id("Choose what this is about"),
  /** A family's own child is used when left out; staff must choose the student. */
  studentId: f.optId(),
  subject: f.text(2, 120, "Add a short title"),
  details: body,
  values: z.record(z.string(), z.string().max(500)).default({}),
  linkLabel: f.optText(80),
  linkHref: appHref,
  aboutUserIds: f.list().pipe(z.array(z.uuid("Choose one")).max(MAX_ABOUT, `Name at most ${MAX_ABOUT} people`)),
});

const fieldInput = z.object({
  id: z.string().trim().regex(/^[a-z][a-z0-9_]{0,30}$/, "Use letters and numbers, starting with a letter"),
  label: f.text(1, 80, "Add a label"),
  kind: z.enum(["text", "date", "choice"]),
  required: f.bool(),
  options: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
});
const levelInput = z.object({ label: f.text(1, 60, "Name this level"), role: f.text(1, 60, "Choose who"), afterDays: f.int(1, 60) });

export const categoryInput = z.object({
  id: f.optId(),
  name: f.text(2, 60, "Add a name"),
  nature: z.enum(NATURES).default("general"),
  ownerUserId: f.optId(),
  ownerRole: f.text(1, 60, "Choose who answers"),
  targetDays: f.int(1, 60),
  escalation: z.array(levelInput).max(MAX_LEVELS).default([]),
  fields: z.array(fieldInput).max(MAX_QUESTIONS).default([]),
}).superRefine((c, ctx) => {
  c.fields.forEach((fl, i) => {
    if (fl.kind === "choice" && !fl.options?.length) ctx.addIssue({ code: "custom", path: ["fields", i, "options"], message: "Add the choices" });
  });
});

export const assignInput = z.object({ id: f.id(), userId: f.id("Choose a person") });
export const categoryChangeInput = z.object({ id: f.id(), categoryId: f.id("Choose a category") });
export const textInput = z.object({ id: f.id(), body });
export const reasonInput = z.object({ id: f.id(), reason: f.text(3, 500, "Say why") });
export const optReasonInput = z.object({ id: f.id(), reason: f.optText(500) });
export const mergeInput = z.object({ id: f.id(), intoId: f.id("Choose the request to keep") });
export const feedbackInput = z.object({ id: f.id(), solved: f.bool(), note: f.optText(500) });
export const orderInput = z.array(f.id()).min(1).max(60);

export const listFilters = z.object({
  view: z.enum(VIEWS.map((v) => v[0]) as ["mine", ...("unassigned" | "team" | "overdue" | "all")[]]).optional(),
  state: f.optText(20),
  category: f.optId(),
});
