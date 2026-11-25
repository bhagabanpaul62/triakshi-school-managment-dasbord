import { z } from "zod";
import { f } from "@smw/feature-kit";
import { BOARDS } from "@smw/feature-academics/presets";
import { schoolProfileInput } from "@smw/feature-settings/inputs";
import { PRESETS } from "@smw/themes";
import { TEMPLATE_KEYS } from "@smw/site-templates";
import { BAND_KEYS } from "./presets";
import { STEP_KEYS } from "./steps";

const blank = (v: unknown) => (v === "" || v === null ? undefined : v);

/** Step 1: the school details a school fills in at the start. The rest of the profile (GSTIN, UDISE, timezone) keeps its value. */
export const profileStepInput = schoolProfileInput.pick({ name: true, board: true, state: true, city: true, address: true, phone: true, email: true });

/** Step 2. The name and dates are checked by the academic year service; blank dates mean "1 April to 31 March". */
export const yearStepInput = z.object({
  name: z.preprocess((v) => (typeof v === "string" ? v.trim() : v ?? ""), z.string()),
  startsOn: f.optDate(),
  endsOn: f.optDate(),
  terms: z.preprocess(blank, z.enum(["0", "2", "3"]).default("2")),
});

/** Step 3: grade -2 (Nursery) to 12, and how many sections (A, B, C...) each has. */
export const classesStepInput = z.object({
  picks: z.array(z.object({
    grade: z.coerce.number().int().min(-2).max(12),
    sections: z.coerce.number().int().min(1).max(6),
  })).min(1, "Pick at least one class").max(15),
});

/** Step 4: the board's preset subjects the school wants, and the stages each runs in. */
export const subjectsStepInput = z.object({
  board: z.enum(BOARDS),
  picks: z.array(z.object({ name: z.string().trim().min(1), bands: z.array(z.enum(BAND_KEYS)) })).min(1, "Pick at least one subject").max(40),
});

/** Step 6. Blank rows are ignored by the service. */
export const teachersStepInput = z.object({
  rows: z.array(z.object({ name: z.string().trim(), email: z.string().trim() })).max(30, "Invite up to 30 teachers at a time"),
});

/** Step 7. */
export const websiteStepInput = z.object({
  template: z.enum(TEMPLATE_KEYS, { error: "Pick a template" }),
  preset: z.enum(Object.keys(PRESETS) as [string, ...string[]], { error: "Pick a colour theme" }),
});

/** Students by hand: up to ten rows; blank rows are ignored by the service. */
export const studentsByHandInput = z.object({
  rows: z.array(z.object({
    name: z.string().trim(), sectionId: z.string().trim(), guardianName: z.string().trim(), guardianPhone: z.string().trim(),
  })).max(10, "Add up to 10 students at a time"),
});

/** Class teachers: one pick per section; a blank teacher clears the section's class teacher. */
export const classTeachersInput = z.object({
  picks: z.array(z.object({ sectionId: z.string().trim().min(1), teacherId: z.string().trim() })).min(1, "Pick at least one class teacher").max(400),
});

/** A second admin or an office login. */
export const teamStepInput = z.object({
  name: z.string().trim().min(2, "Enter the full name").max(120),
  email: z.string().trim().pipe(z.email("Enter a valid email address")),
  role: z.enum(["admin", "accountant"], { error: "Pick a role" }),
});

export const askUsInput = z.object({
  step: z.enum(STEP_KEYS),
  body: z.string().trim().min(5, "Tell us what you need help with").max(2000, "Keep it under 2000 characters"),
});

export const skipStepInput = z.object({ step: z.enum(STEP_KEYS) });

/** Getting started. */
export const taskKeyInput = z.object({ key: z.string().trim().min(1).max(60) });
export const assignTaskInput = z.object({ key: z.string().trim().min(1).max(60), userId: z.uuid("Pick a colleague") });
export const skipTaskInput = z.object({ key: z.string().trim().min(1).max(60), reason: z.string().trim().min(3, "Say why in a few words").max(300, "Keep it under 300 characters") });
