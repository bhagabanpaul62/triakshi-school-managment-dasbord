import { z } from "zod";
import { f } from "@smw/feature-kit";
import { EMPLOYMENT_TYPES, STAFF_GENDERS } from "./schema";

const blank = (v: unknown) => (v === "" || v === null ? undefined : v);

/** A built-in role by key, or a custom role by id. */
const role = z.string({ error: "Pick a role" }).min(1, "Pick a role");

/** Everything about the person except the role (shared by create and edit). */
const person = {
  name: f.text(2, 120, "Enter the full name"),
  employeeId: f.text(1, 30, "Enter the employee ID"),
  email: f.optEmail(),
  phone: f.optPhone(),
  designation: f.optText(80),
  department: f.optText(80),
  qualification: f.optText(120),
  joiningDate: f.optDate(),
  gender: z.preprocess((v) => (v === "" ? undefined : v), z.enum(STAFF_GENDERS).optional()),
  dob: f.optDate(),
  address: f.optText(300),
  employmentType: z.preprocess(blank, z.enum(EMPLOYMENT_TYPES).optional()),
  experienceYears: z.preprocess(blank, z.coerce.number({ error: "Enter years as a number" }).int("Enter whole years").min(0, "Enter 0 or more").max(60, "Enter at most 60").optional()),
  bloodGroup: z.preprocess(blank, z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"], { error: "Use a blood group like O+" }).optional()),
  emergencyName: f.optText(80),
  emergencyPhone: f.optPhone(),
};

export const staffInput = z.object({ role, ...person });
export const staffUpdateInput = z.object(person);
/** What a staff member may change about themselves; everything else stays with the office. */
export const myContactInput = z.object({
  phone: f.optPhone(), address: f.optText(300), emergencyName: f.optText(80), emergencyPhone: f.optPhone(), qualification: f.optText(120),
});
export const roleInput = z.object({ role });

export const resetPasswordInput = z.object({
  token: z.string().min(10, "This link is not valid"),
  password: z.string().min(8, "Use at least 8 characters").max(128, "Use at most 128 characters"),
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { message: "The two passwords do not match", path: ["confirm"] });
