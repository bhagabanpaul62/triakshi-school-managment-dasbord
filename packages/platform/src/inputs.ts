import { z } from "zod";
import { f, NotFoundError, ValidationError } from "@smw/feature-kit";
import { MODULE_STAGES, STAFF_ROLES } from "@smw/db";

export const RESERVED_SLUGS = ["www", "app", "api", "console", "admin", "mail", "support", "billing", "static", "assets", "cdn", "status", "marketing"] as const;

const slug = z.preprocess(
  (v) => String(v ?? "").trim().toLowerCase(),
  z.string().regex(/^[a-z][a-z0-9-]{1,38}[a-z0-9]$/, "Use 3 to 40 letters, digits or hyphens, starting with a letter")
    .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), "That address is reserved"),
);

export const createSchoolInput = z.object({
  name: f.text(2, 120, "Enter the school name"),
  slug,
  adminName: f.text(2, 100, "Enter the administrator's name"),
  adminEmail: z.preprocess((v) => String(v ?? "").trim(), z.email("Enter a valid email")),
  planId: f.optId(),
  board: f.optText(40),
  state: f.optText(60),
  city: f.optText(60),
  trialDays: f.optInt(1, 90),
});
export type CreateSchoolInput = z.output<typeof createSchoolInput>;

export const overrideInput = z.object({
  moduleKey: f.text(1, 60, "Choose a module"),
  enabled: f.bool(),
  note: f.optText(300),
  expiresAt: f.optDate(),
});

export const planEditInput = z.object({
  name: f.text(2, 60),
  studentCap: f.int(1, 100_000),
  priceAnnualPaise: f.paise(0),
  priceMonthlyPaise: f.paise(0),
  moduleKeys: f.list(),
  isPublic: f.bool(),
});

export const staffInput = z.object({
  name: f.text(2, 100),
  email: z.preprocess((v) => String(v ?? "").trim(), z.email("Enter a valid email")),
  role: z.enum(STAFF_ROLES, "Choose a role"),
  password: z.string().min(10, "Use at least 10 characters").max(200),
});

export const stageInput = z.enum(MODULE_STAGES);
export const supportLoginInput = z.object({
  schoolId: f.id(),
  userId: f.optId(),
  reason: f.text(5, 300, "Say why you are logging in (at least 5 characters)"),
  allowWrites: f.bool(),
});
export const replyInput = z.object({ body: f.text(1, 5000, "Write a reply") });

/** Ids and enum filters arrive from URLs and forms; reject bad ones as 404/validation instead of a Postgres cast error. */
export function assertId(id: unknown, what = "Record"): string {
  if (typeof id !== "string" || !z.uuid().safeParse(id).success) throw new NotFoundError(what);
  return id;
}
export function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined || value === "") return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new ValidationError({ filter: "Unknown filter value" });
  return value as T;
}
