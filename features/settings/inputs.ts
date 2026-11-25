import { z } from "zod";
import { CUSTOM_ROLE_BASES } from "@smw/db";
import { f } from "@smw/feature-kit";

/** Base kinds of a staff login (a custom role is "staff" or "teacher"). Student logins keep theirs. */
export const STAFF_ROLES = ["admin", "accountant", "teacher", "staff"] as const;

/** Optional text that must match a pattern ("" → undefined). */
const optPattern = (re: RegExp, msg: string, upper = false) =>
  z.preprocess(
    (v) => (v === "" || v == null ? undefined : upper && typeof v === "string" ? v.trim().toUpperCase() : v),
    z.string().trim().regex(re, msg).optional(),
  );

const validZone = (tz: string) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };

/** Optional web address: "" → undefined; with or without http. */
const optSite = z.preprocess((v) => (v === "" || v == null ? undefined : typeof v === "string" ? v.trim() : v), z.string().max(200).regex(/^(https?:\/\/)?[^\s/.]+\.[^\s]+$/i, "Enter a web address like www.school.in").optional());

/**
 * The school profile form. The ten fields marked "new" are left alone when a caller does not send them (see SchoolProfileService.update),
 * so a form that shows only some of them, or the setup wizard, never wipes the rest.
 */
export const schoolProfileInput = z.object({
  name: f.text(2, 120, "Enter the school name"),
  board: f.optText(60),
  state: f.optText(60),
  city: f.optText(80),
  address: f.optText(300),
  phone: f.optPhone(),
  email: f.optEmail(),
  gstin: optPattern(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Enter a valid 15-character GSTIN", true),
  udiseCode: optPattern(/^\d{11}$/, "UDISE+ code is 11 digits"),
  timezone: f.text(1, 60, "Choose a timezone").refine(validZone, "Choose a valid timezone"),
  academicYearStartMonth: f.int(1, 12),
  // new
  affiliationNo: f.optText(40),
  schoolCode: f.optText(40),
  schoolType: f.optText(40),
  medium: f.optText(60),
  establishedYear: f.optInt(1800, new Date().getFullYear()),
  district: f.optText(80),
  pincode: optPattern(/^[1-9]\d{5}$/, "PIN code is 6 digits"),
  website: optSite,
  headName: f.optText(100),
  headQualification: f.optText(120),
});

/** Columns added later: a key the caller left out is not changed, "" clears it. */
export const NEW_PROFILE_KEYS = ["affiliationNo", "schoolCode", "schoolType", "medium", "establishedYear", "district", "pincode", "website", "headName", "headQualification"] as const;

/** Add a login: who, how to reach them, which role, and whether the invite goes by email or as a link to hand over. */
export const loginInput = z.object({
  name: f.text(2, 100, "Enter their name"),
  email: f.optEmail(),
  phone: f.optPhone(),
  role: z.string().min(1, "Pick a role"),
  send: z.preprocess((v) => (v === "" || v == null ? "email" : v), z.enum(["email", "link"])),
}).refine((v) => v.email || v.phone, { message: "Enter an email or a mobile number", path: ["email"] });

export const bulkInput = z.object({
  ids: z.array(z.uuid()).min(1, "Select at least one person").max(100, "Select up to 100 people at a time"),
  action: z.enum(["resend", "disable", "signout"]),
});

export const profileInput = z.object({
  name: f.text(2, 100, "Enter your name"),
  email: f.optEmail(),
  phone: f.optPhone(),
});

export const passwordInput = z.object({
  current: f.text(1, 200, "Enter your current password"),
  next: f.text(8, 200, "Use at least 8 characters"),
  confirm: f.text(1, 200, "Type the new password again"),
}).refine((v) => v.next === v.confirm, { message: "The passwords do not match", path: ["confirm"] })
  .refine((v) => v.next !== v.current, { message: "Choose a password you have not used here", path: ["next"] });

/** A login's role: a built-in one by key, or a custom role by id. */
export const roleInput = z.object({ role: z.string().min(1, "Pick a role") });

export const resetInput = z.object({ mode: z.enum(["email", "temporary"]).default("email") });

/** The role form sends one checkbox group per module (`g.fees`, `g.library`...); fold them into one `grants` list. */
const foldGrants = (v: unknown) => {
  if (!v || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  const grants = Object.entries(o).filter(([k]) => k.startsWith("g.")).flatMap(([, x]) => (Array.isArray(x) ? x : [x])).filter(Boolean);
  return { ...o, grants: o.grants ?? grants };
};
export const customRoleInput = z.preprocess(foldGrants, z.object({
  name: f.text(2, 60, "Enter a role name"),
  base: z.enum(CUSTOM_ROLE_BASES, { error: "Choose how this role works" }),
  description: f.optText(200),
  grants: z.array(z.string()),
  confirmRemoval: f.bool(),
}));

export const exportStudentInput = z.object({ studentId: f.id("Choose a student") });
