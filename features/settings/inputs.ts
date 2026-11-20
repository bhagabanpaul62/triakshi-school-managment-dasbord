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
}));

export const exportStudentInput = z.object({ studentId: f.id("Choose a student") });
