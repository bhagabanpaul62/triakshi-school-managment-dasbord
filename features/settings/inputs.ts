import { z } from "zod";
import { f } from "@smw/feature-kit";

/** Staff logins can move between these. Student and parent logins keep theirs. */
export const STAFF_ROLES = ["admin", "accountant", "teacher"] as const;

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

export const roleInput = z.object({ role: z.enum(STAFF_ROLES) });

export const exportStudentInput = z.object({ studentId: f.id("Choose a student") });
